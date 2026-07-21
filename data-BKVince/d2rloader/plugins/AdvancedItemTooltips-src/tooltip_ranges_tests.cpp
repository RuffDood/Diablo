#include "tooltip_ranges.hpp"

#include <cassert>
#include <filesystem>
#include <string>
#include <vector>

using tcp::tooltips::AppendRanges;
using tcp::tooltips::FirstSignedInteger;
using tcp::tooltips::FormatPositiveRange;
using tcp::tooltips::ModifierRange;

int main(int argc, char** argv) {
    assert(FirstSignedInteger("\xC3\xBF" "c3-15% to Enemy Lightning Resistance") == -15);
    assert(FormatPositiveRange(-20, -15) == "\xC3\xBF" "cU[15 - 20]\xC3\xBF" "c3");

    const std::string source =
        "\xC3\xBF" "c3+25% Faster Cast Rate\n"
        "\xC3\xBF" "c3-15% to Enemy Lightning Resistance\n"
        "\xC3\xBF" "c3+108 Defense";
    const std::vector<ModifierRange> ranges{
        {"pierce_ltng", "-#% to Enemy Lightning Resistance", 8, 15, 100},
        {"armorclass", "+# Defense", 100, 200, 90},
    };
    const auto enhanced = AppendRanges(source, ranges);
    assert(enhanced.find("-15% to Enemy Lightning Resistance \xC3\xBF" "cU[8 - 15]\xC3\xBF" "c3") != std::string::npos);
    assert(enhanced.find("+108 Defense \xC3\xBF" "cU[100 - 200]\xC3\xBF" "c3") != std::string::npos);
    assert(enhanced.find("+25% Faster Cast Rate \xC3\xBF" "cU") == std::string::npos);

    if (argc == 2) {
        tcp::tooltips::RangeCatalog catalog;
        std::string error;
        assert(catalog.Load(std::filesystem::path(argv[1]), error));
        tcp::tooltips::ItemAffixIds griffon{};
        griffon.quality = 7;
        griffon.fileIndex = 336;
        const auto griffonRanges = catalog.Resolve(griffon);
        const auto hasRange = [&](std::string_view stat, int minimum, int maximum) {
            for (const auto& range : griffonRanges) {
                if (range.stat == stat && range.minimum == minimum && range.maximum == maximum) return true;
            }
            return false;
        };
        assert(hasRange("armorclass", 100, 200));
        assert(hasRange("passive_ltng_mastery", 10, 15));
        assert(hasRange("passive_ltng_pierce", 8, 15));
        assert(catalog.FindArmor("ci3")->minimum == 50);
        assert(catalog.FindArmor("ci3")->maximum == 60);
    }
    return 0;
}
