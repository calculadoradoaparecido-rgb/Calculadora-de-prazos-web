// Comarcas de trabalho (sede) e municípios vinculados.
export const COMARCAS = [
  { sede: 'Araripe', vinculadas: ['Potengi'] },
  { sede: 'Assaré', vinculadas: ['Tarrafas', 'Antonina do Norte'] },
  { sede: 'Aurora', vinculadas: [] },
  { sede: 'Barbalha', vinculadas: [] },
  { sede: 'Barro', vinculadas: [] },
  { sede: 'Brejo Santo', vinculadas: ['Porteiras', 'Jati', 'Penaforte'] },
  { sede: 'Campos Sales', vinculadas: ['Salitre'] },
  { sede: 'Caririaçu', vinculadas: ['Granjeiro'] },
  { sede: 'Crato', vinculadas: [] },
  { sede: 'Farias Brito', vinculadas: [] },
  { sede: 'Jardim', vinculadas: [] },
  { sede: 'Juazeiro do Norte', vinculadas: [] },
  { sede: 'Lavras da Mangabeira', vinculadas: [] },
  { sede: 'Mauriti', vinculadas: [] },
  { sede: 'Milagres', vinculadas: ['Abaiara'] },
  { sede: 'Missão Velha', vinculadas: [] },
  { sede: 'Nova Olinda', vinculadas: ['Santana do Cariri', 'Altaneira'] }
];

// município -> { comarca, vinculada: bool }
export const COMARCA_DO_MUNICIPIO = new Map(
  COMARCAS.flatMap(c => [[c.sede, { comarca: c.sede, vinculada: false }],
    ...c.vinculadas.map(v => [v, { comarca: c.sede, vinculada: true }])])
);
