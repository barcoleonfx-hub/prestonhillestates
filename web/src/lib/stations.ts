// Stations around our patch, with the lines that serve them. Positions are approximate and only used when
// OpenStreetMap can't be reached (normally the exact position comes from there); the lines are what OpenStreetMap
// doesn't reliably say. "Lioness line" is the London Overground's Euston–Watford line (named in 2024).

export type Station = { name: string; lines: string[]; lat: number; lon: number }

export const STATIONS: Station[] = [
  { name: 'Preston Road', lines: ['Metropolitan'], lat: 51.572, lon: -0.2954 },
  { name: 'Northwick Park', lines: ['Metropolitan'], lat: 51.5785, lon: -0.3184 },
  { name: 'Wembley Park', lines: ['Metropolitan', 'Jubilee'], lat: 51.5636, lon: -0.2795 },
  { name: 'Harrow-on-the-Hill', lines: ['Metropolitan', 'Chiltern Railways'], lat: 51.5793, lon: -0.3366 },
  { name: 'West Harrow', lines: ['Metropolitan'], lat: 51.5795, lon: -0.3533 },
  { name: 'North Harrow', lines: ['Metropolitan'], lat: 51.5846, lon: -0.3625 },
  { name: 'Rayners Lane', lines: ['Metropolitan', 'Piccadilly'], lat: 51.5753, lon: -0.3714 },
  { name: 'Kenton', lines: ['Bakerloo', 'Lioness line'], lat: 51.5817, lon: -0.3171 },
  { name: 'South Kenton', lines: ['Bakerloo', 'Lioness line'], lat: 51.5701, lon: -0.3081 },
  { name: 'North Wembley', lines: ['Bakerloo', 'Lioness line'], lat: 51.5626, lon: -0.3039 },
  { name: 'Wembley Central', lines: ['Bakerloo', 'Lioness line', 'National Rail'], lat: 51.5525, lon: -0.2964 },
  { name: 'Stonebridge Park', lines: ['Bakerloo', 'Lioness line'], lat: 51.5441, lon: -0.2759 },
  { name: 'Harrow & Wealdstone', lines: ['Bakerloo', 'Lioness line', 'National Rail'], lat: 51.5925, lon: -0.3351 },
  { name: 'Headstone Lane', lines: ['Lioness line'], lat: 51.6026, lon: -0.357 },
  { name: 'Kingsbury', lines: ['Jubilee'], lat: 51.5847, lon: -0.2786 },
  { name: 'Queensbury', lines: ['Jubilee'], lat: 51.5942, lon: -0.2861 },
  { name: 'Canons Park', lines: ['Jubilee'], lat: 51.6078, lon: -0.2947 },
  { name: 'Stanmore', lines: ['Jubilee'], lat: 51.6194, lon: -0.3028 },
  { name: 'Neasden', lines: ['Jubilee'], lat: 51.5542, lon: -0.2503 },
  { name: 'Dollis Hill', lines: ['Jubilee'], lat: 51.552, lon: -0.2387 },
  { name: 'Wembley Stadium', lines: ['Chiltern Railways'], lat: 51.5543, lon: -0.2853 },
  { name: 'Sudbury Town', lines: ['Piccadilly'], lat: 51.5507, lon: -0.3156 },
  { name: 'Sudbury Hill', lines: ['Piccadilly'], lat: 51.5567, lon: -0.336 },
  { name: 'Alperton', lines: ['Piccadilly'], lat: 51.5407, lon: -0.2997 },
  { name: 'Colindale', lines: ['Northern'], lat: 51.5955, lon: -0.25 },
  { name: 'Burnt Oak', lines: ['Northern'], lat: 51.6028, lon: -0.2641 },
  { name: 'Edgware', lines: ['Northern'], lat: 51.6137, lon: -0.275 },
]

const key = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\b(station|underground|tube|rail)\b/g, '').replace(/[^a-z]/g, '')
const BY_KEY = new Map(STATIONS.map((s) => [key(s.name), s]))
export const stationByName = (name: string) => BY_KEY.get(key(name)) ?? null
