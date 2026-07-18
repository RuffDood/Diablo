#include "router.hpp"
#include <cassert>
using namespace tcp::autopickup;
int main() {
    static_assert(Classify("hp5").family == Family::Healing);
    static_assert(Classify("mp4").tier == 4);
    static_assert(Classify("rvl").family == Family::Rejuvenation);
    Policy p{true,{false,false,false,false,true,true},{1,0,0,0},1,false};
    assert(Route(p,Classify("hp4"),{true,false,false,false},true)==Destination::Column1);
    assert(Route(p,Classify("hp3"),{true,false,false,false},true)==Destination::Ground);
    assert(Route(p,Classify("hp5"),{false,false,false,false},true)==Destination::Ground);
    p.overflow=true;
    assert(Route(p,Classify("hp5"),{false,false,false,false},true)==Destination::Inventory);
    assert(Route(p,Classify("hp5"),{false,false,false,false},false)==Destination::Ground);
}
