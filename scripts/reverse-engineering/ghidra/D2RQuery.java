// Compact lazy queries against the persistent raw-text D2R 3.2.92777 project.
// @category Diablo

import java.io.BufferedReader;
import java.nio.file.Files;
import java.nio.file.Path;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.SourceType;

public class D2RQuery extends GhidraScript {
    private static final long IMAGE_BASE = 0x140000000L;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String mode = args.length == 0 ? "status" : args[0];
        int limit = args.length >= 3 ? Integer.parseInt(args[2]) : 160;
        String functionMap = args.length == 0 ? "" : args[args.length - 1];

        if (mode.equals("status")) {
            printStatus();
            return;
        }
        if (args.length < 3) {
            throw new IllegalArgumentException(mode + " requires an RVA and limit");
        }

        Address address = addressFor(args[1]);
        switch (mode) {
            case "function":
                printFunction(address, limit, functionMap);
                break;
            case "xrefs-to":
                printXrefsTo(address, limit);
                break;
            case "xrefs-from":
                printXrefsFrom(address, limit, functionMap);
                break;
            default:
                throw new IllegalArgumentException("Unsupported mode: " + mode);
        }
    }

    private Address addressFor(String text) {
        long value = Long.decode(text);
        if (Long.compareUnsigned(value, IMAGE_BASE) < 0) {
            value += IMAGE_BASE;
        }
        return toAddr(value);
    }

    private String rva(Address address) {
        return String.format("0x%X", address.getOffset() - IMAGE_BASE);
    }

    private void printStatus() {
        FunctionManager manager = currentProgram.getFunctionManager();
        println("program=" + currentProgram.getName());
        println("imageBase=" + currentProgram.getImageBase());
        println("minAddress=" + currentProgram.getMinAddress());
        println("maxAddress=" + currentProgram.getMaxAddress());
        println("functionsPersisted=" + manager.getFunctionCount());
        println("analysisMode=lazy-per-function");
        println("language=" + currentProgram.getLanguageID());
        println("compiler=" + currentProgram.getCompilerSpec().getCompilerSpecID());
    }

    private Function containingFunction(Address address) {
        FunctionManager manager = currentProgram.getFunctionManager();
        Function function = manager.getFunctionContaining(address);
        if (function == null) {
            function = manager.getFunctionAt(address);
        }
        return function;
    }

    private Function ensureFunction(Address address, String functionMap) throws Exception {
        Function function = containingFunction(address);
        if (function != null) {
            return function;
        }

        long targetRva = address.getOffset() - IMAGE_BASE;
        try (BufferedReader reader = Files.newBufferedReader(Path.of(functionMap))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("start_rva")) {
                    continue;
                }
                String[] fields = line.split(",");
                long startRva = Long.decode(fields[0]);
                long endRva = Long.decode(fields[1]);
                if (startRva <= targetRva && targetRva < endRva) {
                    Address start = toAddr(IMAGE_BASE + startRva);
                    Address end = toAddr(IMAGE_BASE + endRva - 1);
                    AddressSet body = new AddressSet(start, end);

                    DisassembleCommand disassemble = new DisassembleCommand(start, body, true);
                    disassemble.enableCodeAnalysis(false);
                    if (!disassemble.applyTo(currentProgram, monitor)) {
                        println("disassemble=failed status=" + disassemble.getStatusMsg());
                        return null;
                    }

                    CreateFunctionCmd create = new CreateFunctionCmd(
                        "FUN_" + Long.toHexString(startRva).toUpperCase(),
                        start,
                        body,
                        SourceType.ANALYSIS
                    );
                    if (!create.applyTo(currentProgram, monitor)) {
                        println("createFunction=failed status=" + create.getStatusMsg());
                        return null;
                    }
                    println(
                        "lazyAnalysis=created entry=0x" + Long.toHexString(startRva).toUpperCase() +
                        " end=0x" + Long.toHexString(endRva).toUpperCase()
                    );
                    return create.getFunction();
                }
            }
        }
        return null;
    }

    private void printFunction(Address address, int limit, String functionMap) throws Exception {
        Function function = ensureFunction(address, functionMap);
        if (function == null) {
            println("function=missing target=" + rva(address));
            return;
        }
        println(
            "function=" + function.getName() +
            " entry=" + rva(function.getEntryPoint()) +
            " target=" + rva(address) +
            " body=" + function.getBody()
        );

        DecompInterface decompiler = new DecompInterface();
        try {
            decompiler.openProgram(currentProgram);
            DecompileResults results = decompiler.decompileFunction(function, 60, monitor);
            if (results.decompileCompleted() && results.getDecompiledFunction() != null) {
                String[] lines = results.getDecompiledFunction().getC().split("\\R");
                int count = Math.min(lines.length, limit);
                for (int index = 0; index < count; index++) {
                    println(lines[index]);
                }
                if (lines.length > count) {
                    println("... truncated " + (lines.length - count) + " lines");
                }
                return;
            }
            println("decompile=unavailable message=" + results.getErrorMessage());
        }
        finally {
            decompiler.dispose();
        }
    }

    private void printXrefsTo(Address address, int limit) {
        ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(address);
        int count = 0;
        while (references.hasNext() && count < limit) {
            Reference reference = references.next();
            Function source = containingFunction(reference.getFromAddress());
            println(
                reference.getReferenceType() +
                " source=" + rva(reference.getFromAddress()) +
                " function=" + (source == null ? "<none>" : source.getName() + "@" + rva(source.getEntryPoint()))
            );
            count++;
        }
        println("xrefsTo=" + rva(address) + " shown=" + count + " limit=" + limit + " scope=lazy-project-only");
    }

    private void printXrefsFrom(Address address, int limit, String functionMap) throws Exception {
        Function function = ensureFunction(address, functionMap);
        if (function == null) {
            println("function=missing target=" + rva(address));
            return;
        }
        int count = 0;
        InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
            Instruction instruction = instructions.next();
            for (Reference reference : instruction.getReferencesFrom()) {
                println(
                    reference.getReferenceType() +
                    " source=" + rva(reference.getFromAddress()) +
                    " target=" + rva(reference.getToAddress())
                );
                count++;
                if (count >= limit) {
                    println("xrefsFrom=" + rva(function.getEntryPoint()) + " shown=" + count + " limit=" + limit);
                    return;
                }
            }
        }
        println("xrefsFrom=" + rva(function.getEntryPoint()) + " shown=" + count + " limit=" + limit);
    }
}
