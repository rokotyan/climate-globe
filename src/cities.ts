/** The largest urban agglomerations, for orientation on an otherwise blank globe. */
export interface City {
  name: string;
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  {name: 'Tokyo', lat: 35.7, lon: 139.7},
  {name: 'Delhi', lat: 28.6, lon: 77.2},
  {name: 'Shanghai', lat: 31.2, lon: 121.5},
  {name: 'Dhaka', lat: 23.8, lon: 90.4},
  {name: 'São Paulo', lat: -23.5, lon: -46.6},
  {name: 'Mexico City', lat: 19.4, lon: -99.1},
  {name: 'Cairo', lat: 30.0, lon: 31.2},
  {name: 'Beijing', lat: 39.9, lon: 116.4},
  {name: 'Mumbai', lat: 19.1, lon: 72.9},
  {name: 'Osaka', lat: 34.7, lon: 135.5},
  {name: 'New York', lat: 40.7, lon: -74.0},
  {name: 'Karachi', lat: 24.9, lon: 67.0},
  {name: 'Buenos Aires', lat: -34.6, lon: -58.4},
  {name: 'Lagos', lat: 6.5, lon: 3.4},
  {name: 'Istanbul', lat: 41.0, lon: 29.0},
  {name: 'Moscow', lat: 55.8, lon: 37.6},
  {name: 'Jakarta', lat: -6.2, lon: 106.8},
  {name: 'Los Angeles', lat: 34.1, lon: -118.2},
  {name: 'Manila', lat: 14.6, lon: 121.0},
  {name: 'Lima', lat: -12.0, lon: -77.0}
];
