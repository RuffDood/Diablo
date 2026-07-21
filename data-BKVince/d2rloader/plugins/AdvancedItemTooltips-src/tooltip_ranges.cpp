#include "tooltip_ranges.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <map>
#include <sstream>

namespace tcp::tooltips {
namespace {

using Row = std::unordered_map<std::string, std::string>;

std::vector<std::string> SplitTabs(std::string line) {
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    std::vector<std::string> fields;
    std::size_t start{};
    while (true) {
        const auto tab = line.find('\t', start);
        fields.emplace_back(line.substr(start, tab - start));
        if (tab == std::string::npos) {
            break;
        }
        start = tab + 1;
    }
    return fields;
}

bool ReadTsv(const std::filesystem::path& path, std::vector<Row>& rows, std::string& error) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        error = "Cannot open " + path.string();
        return false;
    }
    std::string line;
    if (!std::getline(input, line)) {
        error = "Missing header in " + path.string();
        return false;
    }
    const auto headers = SplitTabs(std::move(line));
    while (std::getline(input, line)) {
        const auto values = SplitTabs(std::move(line));
        Row row;
        for (std::size_t index = 0; index < headers.size() && index < values.size(); ++index) {
            if (!values[index].empty()) {
                row.emplace(headers[index], values[index]);
            }
        }
        rows.emplace_back(std::move(row));
    }
    return true;
}

std::string Get(const Row& row, std::string_view key) {
    const auto found = row.find(std::string(key));
    return found == row.end() ? std::string{} : found->second;
}

std::int32_t Number(const Row& row, std::string_view key) {
    const auto value = Get(row, key);
    if (value.empty()) {
        return 0;
    }
    std::int32_t result{};
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
    return parsed.ec == std::errc{} ? result : 0;
}

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::vector<ModifierRange> ReadModifiers(
    const Row& row,
    const std::unordered_map<std::string, RangeCatalog::PropertyInfo>& properties,
    std::string_view codePrefix,
    std::string_view minPrefix,
    std::string_view maxPrefix,
    std::size_t count
) {
    std::vector<ModifierRange> result;
    for (std::size_t slot = 1; slot <= count; ++slot) {
        const auto suffix = std::to_string(slot);
        const auto propertyCode = Lower(Get(row, std::string(codePrefix) + suffix));
        const auto property = properties.find(propertyCode);
        if (propertyCode.empty() || property == properties.end() || property->second.stat.empty()) {
            continue;
        }
        auto minimum = Number(row, std::string(minPrefix) + suffix);
        auto maximum = Number(row, std::string(maxPrefix) + suffix);
        if (minimum > maximum) {
            std::swap(minimum, maximum);
        }
        result.push_back({property->second.stat, property->second.anchor, minimum, maximum, property->second.priority});
    }
    return result;
}

void AddRecord(
    const std::vector<std::vector<ModifierRange>>& records,
    std::size_t index,
    std::vector<ModifierRange>& output
) {
    if (index < records.size()) {
        output.insert(output.end(), records[index].begin(), records[index].end());
    }
}

std::string StripColors(std::string_view text) {
    std::string clean;
    clean.reserve(text.size());
    for (std::size_t index = 0; index < text.size();) {
        const auto byte = static_cast<unsigned char>(text[index]);
        if (byte == 0xFF && index + 2 < text.size() && text[index + 1] == 'c') {
            index += 3;
        } else if (byte == 0xC3 && index + 3 < text.size()
            && static_cast<unsigned char>(text[index + 1]) == 0xBF
            && text[index + 2] == 'c') {
            index += 4;
        } else {
            clean.push_back(text[index++]);
        }
    }
    return clean;
}

std::string NormalizeWords(std::string_view text) {
    const auto clean = StripColors(text);
    std::string normalized;
    bool pendingSpace{};
    for (const auto raw : clean) {
        const auto ch = static_cast<unsigned char>(raw);
        if (std::isalpha(ch) || ch >= 0x80) {
            if (pendingSpace && !normalized.empty()) normalized.push_back(' ');
            normalized.push_back(ch < 0x80 ? static_cast<char>(std::tolower(ch)) : raw);
            pendingSpace = false;
        } else if (!normalized.empty()) {
            pendingSpace = true;
        }
    }
    return normalized;
}

bool RollFits(std::int32_t roll, const ModifierRange& range) {
    const auto magnitude = static_cast<std::int64_t>(roll) < 0
        ? -static_cast<std::int64_t>(roll)
        : static_cast<std::int64_t>(roll);
    const auto first = std::llabs(static_cast<long long>(range.minimum));
    const auto second = std::llabs(static_cast<long long>(range.maximum));
    return magnitude >= std::min(first, second) && magnitude <= std::max(first, second);
}

bool DescriptionFits(std::string_view line, const ModifierRange& range) {
    const auto anchor = NormalizeWords(range.anchor);
    if (anchor.empty()) return false;
    return NormalizeWords(line).find(anchor) != std::string::npos;
}

} // namespace

bool RangeCatalog::Load(const std::filesystem::path& excelDirectory, std::string& error) {
    properties_.clear();
    suffixes_.clear();
    prefixes_.clear();
    automagic_.clear();
    uniques_.clear();
    sets_.clear();
    armor_.clear();

    std::vector<Row> stats;
    std::vector<Row> properties;
    if (!ReadTsv(excelDirectory / "itemstatcost.txt", stats, error)
        || !ReadTsv(excelDirectory / "properties.txt", properties, error)) {
        return false;
    }

    std::unordered_map<std::string, std::int32_t> priorities;
    for (const auto& row : stats) {
        priorities[Lower(Get(row, "Stat"))] = Number(row, "descpriority");
    }
    for (const auto& row : properties) {
        const auto code = Lower(Get(row, "code"));
        const auto stat = Lower(Get(row, "stat1"));
        if (!code.empty() && !stat.empty()) {
            properties_[code] = {stat, Get(row, "*Tooltip"), priorities[stat]};
        }
    }

    auto loadMagic = [&](std::string_view file, std::vector<std::vector<ModifierRange>>& target) {
        std::vector<Row> rows;
        if (!ReadTsv(excelDirectory / file, rows, error)) {
            return false;
        }
        target.resize(rows.size() + 1);
        for (std::size_t index = 0; index < rows.size(); ++index) {
            target[index + 1] = ReadModifiers(rows[index], properties_, "mod", "mod", "mod", 3);
            // Magic tables use modNcode/modNmin/modNmax rather than codeN/minN/maxN.
            target[index + 1].clear();
            for (std::size_t slot = 1; slot <= 3; ++slot) {
                const auto number = std::to_string(slot);
                const auto code = Lower(Get(rows[index], "mod" + number + "code"));
                const auto property = properties_.find(code);
                if (property == properties_.end()) {
                    continue;
                }
                auto minimum = Number(rows[index], "mod" + number + "min");
                auto maximum = Number(rows[index], "mod" + number + "max");
                if (minimum > maximum) std::swap(minimum, maximum);
                target[index + 1].push_back({property->second.stat, property->second.anchor, minimum, maximum, property->second.priority});
            }
        }
        return true;
    };

    if (!loadMagic("magicsuffix.txt", suffixes_)
        || !loadMagic("magicprefix.txt", prefixes_)
        || !loadMagic("automagic.txt", automagic_)) {
        return false;
    }

    auto loadItems = [&](std::string_view file, std::size_t count, std::vector<std::vector<ModifierRange>>& target) {
        std::vector<Row> rows;
        if (!ReadTsv(excelDirectory / file, rows, error)) {
            return false;
        }
        std::size_t maximumId{};
        for (const auto& row : rows) {
            maximumId = std::max(maximumId, static_cast<std::size_t>(std::max(0, Number(row, "*ID"))));
        }
        target.resize(maximumId + 1);
        for (const auto& row : rows) {
            const auto id = static_cast<std::size_t>(std::max(0, Number(row, "*ID")));
            target[id] = ReadModifiers(row, properties_, "prop", "min", "max", count);
        }
        return true;
    };
    if (!loadItems("uniqueitems.txt", 12, uniques_)
        || !loadItems("setitems.txt", 9, sets_)) {
        return false;
    }

    std::vector<Row> armor;
    if (!ReadTsv(excelDirectory / "armor.txt", armor, error)) {
        return false;
    }
    for (const auto& row : armor) {
        const auto code = Lower(Get(row, "code"));
        if (!code.empty()) {
            armor_[code] = {Number(row, "minac"), Number(row, "maxac")};
        }
    }
    return true;
}

std::vector<ModifierRange> RangeCatalog::Resolve(const ItemAffixIds& ids) const {
    std::vector<ModifierRange> raw;
    const auto suffixCount = suffixes_.empty() ? 0U : suffixes_.size() - 1U;
    const auto prefixCount = prefixes_.empty() ? 0U : prefixes_.size() - 1U;

    auto addSuffix = [&](std::uint16_t id) {
        AddRecord(suffixes_, id, raw);
    };
    auto addPrefix = [&](std::uint16_t id) {
        if (id > suffixCount) {
            AddRecord(prefixes_, id - suffixCount, raw);
        } else {
            AddRecord(prefixes_, id, raw);
        }
    };
    addPrefix(ids.rarePrefix);
    addSuffix(ids.rareSuffix);
    for (auto id : ids.magicPrefix) addPrefix(id);
    for (auto id : ids.magicSuffix) addSuffix(id);
    if (ids.autoPrefix) {
        const auto combinedOffset = suffixCount + prefixCount;
        const auto index = ids.autoPrefix > combinedOffset
            ? ids.autoPrefix - combinedOffset
            : ids.autoPrefix;
        AddRecord(automagic_, index, raw);
    }
    if (ids.quality == 5) AddRecord(sets_, ids.fileIndex, raw);
    if (ids.quality == 7) AddRecord(uniques_, ids.fileIndex, raw);

    std::map<std::string, ModifierRange> combined;
    for (const auto& range : raw) {
        auto [entry, inserted] = combined.try_emplace(range.stat, range);
        if (!inserted) {
            entry->second.minimum += range.minimum;
            entry->second.maximum += range.maximum;
            entry->second.priority = std::max(entry->second.priority, range.priority);
        }
    }
    std::vector<ModifierRange> result;
    for (auto& [_, range] : combined) {
        if (range.minimum != range.maximum) result.push_back(std::move(range));
    }
    std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) {
        return left.priority > right.priority;
    });
    return result;
}

std::optional<ArmorRange> RangeCatalog::FindArmor(std::string_view code) const {
    const auto found = armor_.find(Lower(std::string(code)));
    return found == armor_.end() ? std::nullopt : std::optional(found->second);
}

std::optional<std::int32_t> FirstSignedInteger(std::string_view text) {
    const auto clean = StripColors(text);
    for (std::size_t index = 0; index < clean.size(); ++index) {
        if (!std::isdigit(static_cast<unsigned char>(clean[index]))
            && !((clean[index] == '+' || clean[index] == '-')
                && index + 1 < clean.size()
                && std::isdigit(static_cast<unsigned char>(clean[index + 1])))) {
            continue;
        }
        const auto start = index;
        if (clean[index] == '+' || clean[index] == '-') ++index;
        while (index < clean.size() && std::isdigit(static_cast<unsigned char>(clean[index]))) ++index;
        std::int32_t value{};
        const auto parsed = std::from_chars(clean.data() + start, clean.data() + index, value);
        if (parsed.ec == std::errc{}) return value;
    }
    return std::nullopt;
}

std::string FormatPositiveRange(std::int32_t minimum, std::int32_t maximum) {
    auto first = std::llabs(static_cast<long long>(minimum));
    auto second = std::llabs(static_cast<long long>(maximum));
    if (first > second) std::swap(first, second);
    return "\xC3\xBF" "cU[" + std::to_string(first) + " - " + std::to_string(second) + "]\xC3\xBF" "c3";
}

std::string AppendRanges(std::string_view description, const std::vector<ModifierRange>& ranges) {
    std::vector<std::string> lines;
    std::size_t start{};
    while (start <= description.size()) {
        const auto end = description.find('\n', start);
        lines.emplace_back(description.substr(start, end - start));
        if (end == std::string_view::npos) break;
        start = end + 1;
    }
    std::vector<bool> used(lines.size());
    for (const auto& range : ranges) {
        for (std::size_t index = 0; index < lines.size(); ++index) {
            const auto roll = FirstSignedInteger(lines[index]);
            if (!used[index] && roll && RollFits(*roll, range) && DescriptionFits(lines[index], range)) {
                lines[index] += " " + FormatPositiveRange(range.minimum, range.maximum);
                used[index] = true;
                break;
            }
        }
    }
    std::string result;
    for (std::size_t index = 0; index < lines.size(); ++index) {
        if (index) result.push_back('\n');
        result += lines[index];
    }
    return result;
}

} // namespace tcp::tooltips
