/** Pure helpers shared by the browser implementation and its Node tests. */
export function choosePriceFarm(farms = [], activeFarmId = null) {
  const usable = farms.filter((farm) => farm?.region_code);
  return usable.find((farm) => farm.id === activeFarmId) || usable[0] || null;
}

export function placeFromFarm(farm) {
  if (!farm) return null;
  return {
    region: farm.region_code,
    lat: farm.latitude ?? null,
    lng: farm.longitude ?? null,
    name: farm.region_name || farm.region_code,
    farmName: farm.name,
    farmId: farm.id,
    basis: 'farm',
  };
}
