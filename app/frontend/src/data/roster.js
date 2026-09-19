// One roster drives the dashboard tiles, the site map, traffic rows and the account page.
export const roster = [
  { id: 'sense-1', x: 118, y: 96, status: 'ok', canopy: 52, plant: 'Common Hazel', latin: 'Corylus avellana', site: 'Hollow Field, east hedge', baseline: '42.0 mV', last: '4 seconds ago' },
  { id: 'sense-2', x: 214, y: 158, status: 'ok', canopy: 41, plant: 'Pedunculate Oak', latin: 'Quercus robur', site: 'Hollow Field, veteran tree', baseline: '38.6 mV', last: '11 seconds ago' },
  { id: 'sense-3', x: 336, y: 112, status: 'ok', canopy: 29, plant: 'Grey Willow', latin: 'Salix cinerea', site: 'Wet meadow, south ditch', baseline: '45.2 mV', last: '9 seconds ago' },
  { id: 'sense-4', x: 448, y: 198, status: 'quiet', canopy: 18, plant: 'Silver Birch', latin: 'Betula pendula', site: 'North slope, cleared block', baseline: '40.1 mV', last: '6 hours ago' },
  { id: 'sense-5', x: 276, y: 244, status: 'ok', canopy: 24, plant: 'Blackthorn', latin: 'Prunus spinosa', site: 'Wet meadow, west scrub', baseline: '43.4 mV', last: '7 seconds ago' }
];

export const nodeLinks = [[0, 1], [1, 2], [1, 4], [2, 3]];
