import { MAX_PLACE_NAME } from "../config";
import { EQUIPMENT_IDS, EQUIPMENT_PRESETS, type EquipmentId, type Place, type PlaceInput, type Profile, type TodayGear } from "../domain";

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** First place name from the gear picked in Setup (W32): "Gym", "Home" or "Anywhere"; anything else is "My gym". */
export function placeNameForEquipment(equipment: readonly EquipmentId[]): string {
  if (equipment.length === 0) return "Anywhere";
  if (sameSet(equipment, EQUIPMENT_PRESETS.full_gym.equipment)) return "Gym";
  if (sameSet(equipment, EQUIPMENT_PRESETS.home.equipment)) return "Home";
  return "My gym";
}

/** The profile as the planner sees it: gear and dumbbell range come from the place, nothing else changes. */
export function profileForPlace(profile: Profile, place: Pick<Place, "equipment" | "dumbbellRange">): Profile {
  const { dumbbellRange: _old, ...rest } = profile;
  void _old;
  return { ...rest, equipment: [...place.equipment], ...(place.dumbbellRange ? { dumbbellRange: { ...place.dumbbellRange } } : {}) };
}

/** Gear available today: the place minus the unticked items. */
export function gearEquipment(gear: TodayGear): EquipmentId[] {
  const without = new Set(gear.without ?? []);
  return gear.place.equipment.filter((e) => !without.has(e));
}

/** Returns an error message, or undefined when the input is a valid place. */
export function validatePlaceInput(input: PlaceInput): string | undefined {
  const name = input.name?.trim() ?? "";
  if (!name) return "Give the place a name";
  if (name.length > MAX_PLACE_NAME) return `Place name is at most ${MAX_PLACE_NAME} characters`;
  if (!Array.isArray(input.equipment) || !input.equipment.every((e) => (EQUIPMENT_IDS as readonly string[]).includes(e))) return "Unknown equipment in this place";
  if (new Set(input.equipment).size !== input.equipment.length) return "Equipment is listed twice";
  const r = input.dumbbellRange;
  if (r !== undefined && !(Number.isFinite(r.min) && Number.isFinite(r.max) && Number.isFinite(r.step) && r.step > 0 && r.min > 0 && r.min <= r.max)) return "Dumbbell range is not valid";
  return undefined;
}
