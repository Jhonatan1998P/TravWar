// Extraido de GameData.js

export const units = {
      romans: {
          name: 'Romanos',
          description: 'Tropas disciplinadas y una ingeniería superior hacen del ejército romano una fuerza de élite. Son caros y lentos de entrenar, pero increíblemente poderosos.',
          troops: [
              {
                  id: 'legionnaire',
                  name: 'Legionario',
                  description: 'Una unidad de infantería versátil, buena tanto en ataque como en defensa. El pilar de cualquier ejército romano.',
                  type: 'infantry',
                  role: 'versatile',
                  cost: { wood: 120, stone: 100, iron: 150, food: 30 },
                  upkeep: 1,
                  stats: { attack: 40, defense: { infantry: 35, cavalry: 50 }, speed: 6, capacity: 50 },
                  trainTime: 1600,
                  research: { requires: { barracks: 1 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'praetorian',
                  name: 'Pretoriano',
                  description: 'Un especialista defensivo. Su habilidad para detener ataques de infantería no tiene igual, pero es débil atacando.',
                  type: 'infantry',
                  role: 'defensive',
                  cost: { wood: 100, stone: 130, iron: 160, food: 70 },
                  upkeep: 1,
                  stats: { attack: 30, defense: { infantry: 65, cavalry: 35 }, speed: 5, capacity: 20 },
                  trainTime: 1760,
                  research: { requires: { academy: 1, smithy: 1 }, cost: { wood: 2300, stone: 2000, iron: 2500, food: 1200 }, time: 3600 }
              },
              {
                  id: 'imperian',
                  name: 'Imperano',
                  description: 'La élite de la infantería de asalto. Rápidos, letales y temidos en el campo de batalla.',
                  type: 'infantry',
                  role: 'offensive',
                  cost: { wood: 150, stone: 160, iron: 210, food: 80 },
                  upkeep: 1,
                  stats: { attack: 70, defense: { infantry: 40, cavalry: 25 }, speed: 7, capacity: 50 },
                  trainTime: 1920,
                  research: { requires: { academy: 5, smithy: 1 }, cost: { wood: 4500, stone: 5200, iron: 6800, food: 3400 }, time: 7200 }
              },
              {
                  id: 'equites_legati',
                  name: 'Equites Legati',
                  description: 'La unidad de reconocimiento más rápida del juego. Esencial para espiar los recursos y defensas enemigas.',
                  type: 'scout',
                  role: 'scout',
                  cost: { wood: 140, stone: 160, iron: 20, food: 40 },
                  upkeep: 2,
                  stats: { attack: 0, defense: { infantry: 20, cavalry: 10 }, speed: 16, capacity: 0 },
                  trainTime: 1360,
                  research: { requires: { stable: 1, academy: 5 }, cost: { wood: 3200, stone: 2800, iron: 1500, food: 1900 }, time: 4800 }
              },
              {
                  id: 'equites_imperatoris',
                  name: 'Equites Imperatoris',
                  description: 'Caballería estándar, rápida y con una buena capacidad de carga, ideal para saquear aldeas.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 550, stone: 440, iron: 320, food: 100 },
                  upkeep: 3,
                  stats: { attack: 120, defense: { infantry: 65, cavalry: 50 }, speed: 14, capacity: 100 },
                  trainTime: 2640,
                  research: { requires: { stable: 5, academy: 5 }, cost: { wood: 8800, stone: 7100, iron: 5500, food: 4200 }, time: 9600 }
              },
              {
                  id: 'equites_caesaris',
                  name: 'Equites Caesaris',
                  description: 'La caballería más pesada y devastadora. Su consumo de cereal es alto, pero su impacto en batalla lo justifica.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 550, stone: 640, iron: 800, food: 180 },
                  upkeep: 4,
                  stats: { attack: 180, defense: { infantry: 80, cavalry: 105 }, speed: 10, capacity: 70 },
                  trainTime: 3520,
                  research: { requires: { stable: 10, academy: 5 }, cost: { wood: 11200, stone: 10500, iron: 13400, food: 5800 }, time: 14400 }
              },
              {
                  id: 'ram_roman',
                  name: 'Ariete',
                  description: 'Pesado y lento, pero muy efectivo para derribar las defensas enemigas.',
                  type: 'siege',
                  role: 'ram',
                  cost: { wood: 900, stone: 360, iron: 500, food: 70 },
                  upkeep: 3,
                  stats: { attack: 60, defense: { infantry: 30, cavalry: 75 }, speed: 4, capacity: 0 },
                  trainTime: 4600,
                  research: { requires: { academy: 10, workshop: 1 }, cost: { wood: 12100, stone: 8200, iron: 5500, food: 3200 }, time: 10200 }
              },
              {
                  id: 'fire_catapult_roman',
                  name: 'Catapulta de Fuego',
                  description: 'Un arma de asedio precisa y poderosa, capaz de destruir edificios desde la distancia.',
                  type: 'siege',
                  role: 'catapult',
                  cost: { wood: 950, stone: 1350, iron: 600, food: 90 },
                  upkeep: 6,
                  stats: { attack: 75, defense: { infantry: 60, cavalry: 10 }, speed: 3, capacity: 0 },
                  trainTime: 9000,
                  research: { requires: { academy: 15, workshop: 10 }, cost: { wood: 15200, stone: 21000, iron: 11000, food: 4800 }, time: 18500 }
              },
              {
                  id: 'senator_roman',
                  name: 'Senador',
                  description: 'Un maestro de la persuasión, capaz de bajar la lealtad de las aldeas enemigas hasta que se unan a tu imperio.',
                  type: 'chief',
                  role: 'colonization',
                  cost: { wood: 30750, stone: 27200, iron: 45000, food: 37500 },
                  upkeep: 5,
                  stats: { attack: 50, defense: { infantry: 40, cavalry: 30 }, speed: 5, capacity: 0 },
                  trainTime: 90700,
                  research: { requires: { academy: 15, rallyPoint: 10 }, cost: { wood: 45000, stone: 58000, iron: 42000, food: 51000 }, time: 25400 }
              },
              {
                  id: 'settler_roman',
                  name: 'Colono',
                  description: 'Tres valientes ciudadanos que se aventuran a fundar una nueva aldea para la gloria de Roma.',
                  type: 'settler',
                  role: 'conquest',
                  cost: { wood: 5800, stone: 5300, iron: 7200, food: 5500 },
                  upkeep: 1,
                  stats: { attack: 0, defense: { infantry: 80, cavalry: 80 }, speed: 5, capacity: 3000 },
                  trainTime: 26900,
                  research: { requires: { palace: 10 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'merchant_roman',
                  name: 'Mercader',
                  type: 'merchant',
                  role: 'trade',
                  upkeep: 2,
                  stats: { speed: 16, capacity: 500 },
              }
          ]
      },
      germans: {
          name: 'Germanos',
          description: 'La horda germana es temida por su ferocidad y su número. Sus tropas son baratas y rápidas de entrenar, perfectas para un estilo de juego agresivo y de saqueo constante.',
          troops: [
              {
                  id: 'clubswinger',
                  name: 'Luchador de Porra',
                  description: 'La unidad más barata del juego. Débil en defensa, pero su bajo coste permite crear enormes ejércitos de ataque.',
                  type: 'infantry',
                  role: 'offensive',
                  cost: { wood: 95, stone: 75, iron: 40, food: 40 },
                  upkeep: 1,
                  stats: { attack: 40, defense: { infantry: 20, cavalry: 5 }, speed: 7, capacity: 60 },
                  trainTime: 720,
                  research: { requires: { barracks: 1 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'spearman',
                  name: 'Lancero',
                  description: 'Una excelente unidad defensiva, especialmente contra caballería, pero carece de poder ofensivo.',
                  type: 'infantry',
                  role: 'defensive',
                  cost: { wood: 145, stone: 70, iron: 85, food: 40 },
                  upkeep: 1,
                  stats: { attack: 10, defense: { infantry: 35, cavalry: 60 }, speed: 7, capacity: 40 },
                  trainTime: 1120,
                  research: { requires: { academy: 1 }, cost: { wood: 2100, stone: 1500, iron: 1800, food: 1100 }, time: 3200 }
              },
              {
                  id: 'axeman',
                  name: 'Luchador de Hacha',
                  description: 'La infantería de asalto germana. Fuerte, temible, pero vulnerable y costosa.',
                  type: 'infantry',
                  role: 'offensive',
                  cost: { wood: 130, stone: 120, iron: 170, food: 70 },
                  upkeep: 1,
                  stats: { attack: 60, defense: { infantry: 30, cavalry: 30 }, speed: 6, capacity: 50 },
                  trainTime: 1200,
                  research: { requires: { academy: 3, smithy: 1 }, cost: { wood: 2500, stone: 2100, iron: 3400, food: 2200 }, time: 4800 }
              },
              {
                  id: 'scout_german',
                  name: 'Explorador',
                  description: 'Unidad de reconocimiento básica de los germanos, con una defensa sorprendentemente decente.',
                  type: 'scout',
                  role: 'scout',
                  cost: { wood: 160, stone: 100, iron: 50, food: 50 },
                  upkeep: 1,
                  stats: { attack: 0, defense: { infantry: 10, cavalry: 5 }, speed: 9, capacity: 0 },
                  trainTime: 1120,
                  research: { requires: { academy: 1 }, cost: { wood: 2800, stone: 1900, iron: 1200, food: 1500 }, time: 3600 }
              },
              {
                  id: 'paladin',
                  name: 'Paladín',
                  description: 'Caballería defensiva y rápida, ideal para reforzar aldeas amigas y saquear con buena capacidad.',
                  type: 'cavalry',
                  role: 'defensive',
                  cost: { wood: 370, stone: 270, iron: 290, food: 75 },
                  upkeep: 2,
                  stats: { attack: 55, defense: { infantry: 100, cavalry: 40 }, speed: 10, capacity: 110 },
                  trainTime: 2400,
                  research: { requires: { academy: 5, stable: 3 }, cost: { wood: 6500, stone: 5100, iron: 5500, food: 3100 }, time: 7800 }
              },
              {
                  id: 'teutonic_knight',
                  name: 'Caballero Teutón',
                  description: 'Caballería pesada y poderosa, el martillo del ejército germano.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 450, stone: 515, iron: 480, food: 80 },
                  upkeep: 3,
                  stats: { attack: 150, defense: { infantry: 50, cavalry: 75 }, speed: 9, capacity: 80 },
                  trainTime: 2960,
                  research: { requires: { academy: 5, stable: 10 }, cost: { wood: 8200, stone: 9800, iron: 9100, food: 4500 }, time: 11200 }
              },
              {
                  id: 'ram_german',
                  name: 'Ariete',
                  description: 'Una versión más robusta y destructiva del ariete, ideal para derribar murallas resistentes.',
                  type: 'siege',
                  role: 'ram',
                  cost: { wood: 1000, stone: 300, iron: 350, food: 70 },
                  upkeep: 3,
                  stats: { attack: 65, defense: { infantry: 30, cavalry: 80 }, speed: 4, capacity: 0 },
                  trainTime: 4200,
                  research: { requires: { academy: 10, workshop: 1 }, cost: { wood: 13500, stone: 5100, iron: 6200, food: 2900 }, time: 10800 }
              },
              {
                  id: 'catapult_german',
                  name: 'Catapulta',
                  description: 'Máquina de asedio germana, imprecisa pero devastadora.',
                  type: 'siege',
                  role: 'catapult',
                  cost: { wood: 900, stone: 1200, iron: 600, food: 60 },
                  upkeep: 6,
                  stats: { attack: 50, defense: { infantry: 60, cavalry: 10 }, speed: 3, capacity: 0 },
                  trainTime: 9000,
                  research: { requires: { academy: 15, workshop: 10 }, cost: { wood: 14500, stone: 19000, iron: 10500, food: 3500 }, time: 19200 }
              },
              {
                  id: 'chief_german',
                  name: 'Jefe',
                  description: 'Un líder de guerra germano que inspira a sus tropas y puede conquistar aldeas enemigas.',
                  type: 'chief',
                  role: 'conquest',
                  cost: { wood: 35500, stone: 26600, iron: 25000, food: 27200 },
                  upkeep: 4,
                  stats: { attack: 40, defense: { infantry: 60, cavalry: 40 }, speed: 5, capacity: 0 },
                  trainTime: 70500,
                  research: { requires: { academy: 15, rallyPoint: 10 }, cost: { wood: 51000, stone: 38000, iron: 35000, food: 41000 }, time: 26800 }
              },
              {
                  id: 'settler_german',
                  name: 'Colono',
                  description: 'Valientes y tercos ciudadanos que viajan para fundar una nueva aldea en tu nombre.',
                  type: 'settler',
                  role: 'colonization',
                  cost: { wood: 7200, stone: 5500, iron: 5800, food: 6500 },
                  upkeep: 1,
                  stats: { attack: 10, defense: { infantry: 80, cavalry: 80 }, speed: 5, capacity: 3000 },
                  trainTime: 31000,
                  research: { requires: { palace: 10 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'merchant_german',
                  name: 'Mercader',
                  type: 'merchant',
                  role: 'trade',
                  upkeep: 3,
                  stats: { speed: 12, capacity: 1000 },
              }
          ]
      },
      gauls: {
          name: 'Galos',
          description: 'Los galos son maestros de la defensa y la velocidad. Sus tropas son excelentes para tácticas de guerrilla y para defender sus aldeas con una eficacia sin igual.',
          troops: [
              {
                  id: 'phalanx',
                  name: 'Falange',
                  description: 'Una unidad de infantería barata y con una defensa formidable, especialmente contra la caballería.',
                  type: 'infantry',
                  role: 'defensive',
                  cost: { wood: 100, stone: 130, iron: 55, food: 30 },
                  upkeep: 1,
                  stats: { attack: 15, defense: { infantry: 40, cavalry: 50 }, speed: 7, capacity: 35 },
                  trainTime: 1040,
                  research: { requires: { barracks: 1 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'swordsman',
                  name: 'Espadachín',
                  description: 'Una infantería más ofensiva que la Falange, pero con mejores capacidades defensivas que otras unidades de ataque.',
                  type: 'infantry',
                  role: 'versatile',
                  cost: { wood: 140, stone: 150, iron: 185, food: 60 },
                  upkeep: 1,
                  stats: { attack: 65, defense: { infantry: 35, cavalry: 20 }, speed: 6, capacity: 45 },
                  trainTime: 1440,
                  research: { requires: { academy: 1, smithy: 1 }, cost: { wood: 2800, stone: 2400, iron: 3100, food: 1800 }, time: 4200 }
              },
              {
                  id: 'pathfinder',
                  name: 'Explorador',
                  description: 'Un espía rápido y eficiente, perfecto para descubrir los secretos de tus enemigos.',
                  type: 'scout',
                  role: 'scout',
                  cost: { wood: 170, stone: 150, iron: 20, food: 40 },
                  upkeep: 2,
                  stats: { attack: 0, defense: { infantry: 20, cavalry: 10 }, speed: 17, capacity: 0 },
                  trainTime: 1360,
                  research: { requires: { academy: 1, stable: 1 }, cost: { wood: 3100, stone: 3800, iron: 1200, food: 1500 }, time: 3800 }
              },
              {
                  id: 'theutates_thunder',
                  name: 'Trueno de Teutates',
                  description: 'Caballería de saqueo extremadamente rápida. Su velocidad les permite golpear y desaparecer antes de que el enemigo pueda reaccionar.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 350, stone: 450, iron: 230, food: 60 },
                  upkeep: 2,
                  stats: { attack: 90, defense: { infantry: 25, cavalry: 40 }, speed: 19, capacity: 75 },
                  trainTime: 2480,
                  research: { requires: { academy: 5, stable: 3 }, cost: { wood: 6200, stone: 7500, iron: 4100, food: 2900 }, time: 8400 }
              },
              {
                  id: 'druidrider',
                  name: 'Jinete Druida',
                  description: 'Una unidad de caballería defensiva, excelente para reforzar a aliados y para defenderse contra infantería enemiga.',
                  type: 'cavalry',
                  role: 'defensive',
                  cost: { wood: 360, stone: 330, iron: 280, food: 120 },
                  upkeep: 2,
                  stats: { attack: 45, defense: { infantry: 115, cavalry: 55 }, speed: 16, capacity: 35 },
                  trainTime: 2560,
                  research: { requires: { academy: 5, stable: 5 }, cost: { wood: 6800, stone: 6100, iron: 5200, food: 4800 }, time: 9800 }
              },
              {
                  id: 'haeduan',
                  name: 'Eduo',
                  description: 'La caballería de élite de los galos. Son excelentes tanto en ataque como en defensa contra caballería, una verdadera unidad polivalente.',
                  type: 'cavalry',
                  role: 'versatile',
                  cost: { wood: 500, stone: 620, iron: 675, food: 170 },
                  upkeep: 3,
                  stats: { attack: 140, defense: { infantry: 50, cavalry: 165 }, speed: 13, capacity: 65 },
                  trainTime: 3120,
                  research: { requires: { academy: 5, stable: 10 }, cost: { wood: 9500, stone: 11800, iron: 13200, food: 7100 }, time: 12800 }
              },
              {
                  id: 'ram_gaul',
                  name: 'Ariete',
                  description: 'Máquina de asedio diseñada para destruir las murallas y defensas enemigas.',
                  type: 'siege',
                  role: 'ram',
                  cost: { wood: 950, stone: 555, iron: 330, food: 75 },
                  upkeep: 3,
                  stats: { attack: 50, defense: { infantry: 30, cavalry: 105 }, speed: 4, capacity: 0 },
                  trainTime: 5000,
                  research: { requires: { academy: 10, workshop: 1 }, cost: { wood: 12100, stone: 8200, iron: 5500, food: 3200 }, time: 10200 }
              },
              {
                  id: 'trebuchet_gaul',
                  name: 'Trabuco',
                  description: 'Arma de asedio de largo alcance, capaz de destruir cualquier edificio en la aldea enemiga.',
                  type: 'siege',
                  role: 'catapult',
                  cost: { wood: 960, stone: 1450, iron: 630, food: 90 },
                  upkeep: 6,
                  stats: { attack: 70, defense: { infantry: 45, cavalry: 10 }, speed: 3, capacity: 0 },
                  trainTime: 9000,
                  research: { requires: { academy: 15, workshop: 10 }, cost: { wood: 15200, stone: 21000, iron: 11000, food: 4800 }, time: 18500 }
              },
              {
                  id: 'chieftain_gaul',
                  name: 'Cacique',
                  description: 'Un líder carismático que puede persuadir a los habitantes de otras aldeas para que se unan a tu imperio.',
                  type: 'chief',
                  role: 'conquest',
                  cost: { wood: 30750, stone: 45400, iron: 31000, food: 37500 },
                  upkeep: 4,
                  stats: { attack: 40, defense: { infantry: 50, cavalry: 50 }, speed: 4, capacity: 0 },
                  trainTime: 90700,
                  research: { requires: { academy: 15, rallyPoint: 10 }, cost: { wood: 45000, stone: 58000, iron: 42000, food: 51000 }, time: 25400 }
              },
              {
                  id: 'settler_gaul',
                  name: 'Colono',
                  description: 'Valientes ciudadanos que viajan para fundar una nueva aldea en tu nombre.',
                  type: 'settler',
                  role: 'colonization',
                  cost: { wood: 5500, stone: 7000, iron: 5300, food: 4900 },
                  upkeep: 1,
                  stats: { attack: 0, defense: { infantry: 80, cavalry: 80 }, speed: 5, capacity: 3000 },
                  trainTime: 22700,
                  research: { requires: { palace: 10 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'merchant_gaul',
                  name: 'Mercader',
                  type: 'merchant',
                  role: 'trade',
                  upkeep: 2,
                  stats: { speed: 24, capacity: 750 },
              }
          ]
      },
      huns: {
          name: 'Hunos',
          description: 'Los Hunos son una fuerza nómada cuya vida gira en torno a sus caballos. Su ejército es casi enteramente de caballería, ofreciendo una velocidad y una capacidad de ataque sorpresa sin precedentes.',
          troops: [
               {
                  id: 'mercenary_huns',
                  name: 'Mercenario',
                  description: 'Infantería básica y prescindible, útil para defensa temprana y como carne de cañón.',
                  type: 'infantry',
                  role: 'defensive',
                  cost: { wood: 130, stone: 80, iron: 40, food: 40 },
                  upkeep: 1,
                  stats: { attack: 35, defense: { infantry: 40, cavalry: 30 }, speed: 6, capacity: 30 },
                  trainTime: 1120,
                  research: { requires: { barracks: 1 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'bowman_huns',
                  name: 'Arquero',
                  description: 'Infantería de ataque a distancia, buena para debilitar las defensas enemigas antes del choque principal.',
                  type: 'infantry',
                  role: 'offensive',
                  cost: { wood: 140, stone: 110, iron: 60, food: 60 },
                  upkeep: 1,
                  stats: { attack: 50, defense: { infantry: 30, cavalry: 10 }, speed: 6, capacity: 30 },
                  trainTime: 1120,
                  research: { requires: { academy: 3, smithy: 1 }, cost: { wood: 2900, stone: 2800, iron: 2100, food: 1600 }, time: 4500 }
              },
              {
                  id: 'spotter_huns',
                  name: 'Avistador',
                  description: 'El explorador de los hunos. Montado y rápido, perfecto para el reconocimiento del terreno.',
                  type: 'scout',
                  role: 'scout',
                  cost: { wood: 170, stone: 150, iron: 20, food: 40 },
                  upkeep: 2,
                  stats: { attack: 0, defense: { infantry: 20, cavalry: 10 }, speed: 19, capacity: 0 },
                  trainTime: 1360,
                  research: { requires: { academy: 1, stable: 1 }, cost: { wood: 3200, stone: 4100, iron: 1500, food: 1800 }, time: 4000 }
              },
              {
                  id: 'steppe_rider_huns',
                  name: 'Jinete Estepario',
                  description: 'Caballería ligera y muy barata. Perfecta para saqueos masivos en las etapas tempranas y medias del juego.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 290, stone: 370, iron: 190, food: 45 },
                  upkeep: 2,
                  stats: { attack: 120, defense: { infantry: 30, cavalry: 15 }, speed: 16, capacity: 75 },
                  trainTime: 2400,
                  research: { requires: { academy: 5, stable: 3 }, cost: { wood: 6800, stone: 7100, iron: 4500, food: 3200 }, time: 8800 }
              },
              {
                  id: 'marksman_huns',
                  name: 'Tirador',
                  description: 'Arquero a caballo, una unidad versátil que puede atacar y retirarse con gran velocidad.',
                  type: 'cavalry',
                  role: 'versatile',
                  cost: { wood: 320, stone: 350, iron: 330, food: 50 },
                  upkeep: 2,
                  stats: { attack: 110, defense: { infantry: 80, cavalry: 70 }, speed: 16, capacity: 105 },
                  trainTime: 2480,
                  research: { requires: { academy: 5, stable: 5 }, cost: { wood: 7500, stone: 6800, iron: 5800, food: 4100 }, time: 10200 }
              },
              {
                  id: 'marauder_huns',
                  name: 'Merodeador',
                  description: 'La caballería de choque de los hunos. Destroza defensas y es la punta de lanza de cualquier gran ofensiva.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 450, stone: 560, iron: 610, food: 140 },
                  upkeep: 3,
                  stats: { attack: 180, defense: { infantry: 60, cavalry: 40 }, speed: 14, capacity: 80 },
                  trainTime: 2990,
                  research: { requires: { academy: 5, stable: 10 }, cost: { wood: 10500, stone: 12500, iron: 14100, food: 7800 }, time: 13500 }
              },
               {
                  id: 'ram_huns',
                  name: 'Ariete',
                  description: 'Máquina de asedio de los Hunos, construida con materiales ligeros para mantener la velocidad del ejército.',
                  type: 'siege',
                  role: 'ram',
                  cost: { wood: 1060, stone: 330, iron: 360, food: 70 },
                  upkeep: 3,
                  stats: { attack: 65, defense: { infantry: 30, cavalry: 90 }, speed: 4, capacity: 0 },
                  trainTime: 4400,
                  research: { requires: { academy: 10, workshop: 1 }, cost: { wood: 12800, stone: 8800, iron: 6100, food: 3500 }, time: 10500 }
              },
              {
                  id: 'catapult_huns',
                  name: 'Catapulta',
                  description: 'Arma de asedio de los Hunos, diseñada para ser ensamblada y desensamblada rápidamente.',
                  type: 'siege',
                  role: 'catapult',
                  cost: { wood: 950, stone: 1280, iron: 620, food: 60 },
                  upkeep: 6,
                  stats: { attack: 45, defense: { infantry: 55, cavalry: 10 }, speed: 3, capacity: 0 },
                  trainTime: 9000,
                  research: { requires: { academy: 15, workshop: 10 }, cost: { wood: 16100, stone: 20500, iron: 11500, food: 5100 }, time: 19000 }
              },
              {
                  id: 'logades_huns',
                  name: 'Logades',
                  description: 'El líder de la horda, un experto estratega que puede doblegar la voluntad de aldeas enteras.',
                  type: 'chief',
                  role: 'conquest',
                  cost: { wood: 37200, stone: 27600, iron: 25200, food: 27600 },
                  upkeep: 4,
                  stats: { attack: 50, defense: { infantry: 40, cavalry: 30 }, speed: 5, capacity: 0 },
                  trainTime: 90700,
                  research: { requires: { academy: 15, rallyPoint: 10 }, cost: { wood: 48000, stone: 61000, iron: 45000, food: 55000 }, time: 26000 }
              },
              {
                  id: 'settler_huns',
                  name: 'Colono',
                  description: 'Valientes ciudadanos que viajan para fundar una nueva aldea en tu nombre.',
                  type: 'settler',
                  role: 'colonization',
                  cost: { wood: 6100, stone: 4600, iron: 4800, food: 5400 },
                  upkeep: 1,
                  stats: { attack: 0, defense: { infantry: 80, cavalry: 80 }, speed: 5, capacity: 3000 },
                  trainTime: 28950,
                  research: { requires: { palace: 10 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'merchant_huns',
                  name: 'Mercader',
                  type: 'merchant',
                  role: 'trade',
                  upkeep: 2,
                  stats: { speed: 20, capacity: 800 },
              }
          ]
      },
      egyptians: {
          name: 'Egipcios',
          description: 'Los egipcios son maestros constructores y economistas. Su ejército se basa en unidades baratas y una defensa sólida, respaldada por un héroe que potencia la producción de recursos.',
          troops: [
              {
                  id: 'slave_militia_egypt',
                  name: 'Milicia de Esclavos',
                  description: 'La unidad más barata y rápida de producir. Su capacidad de carga la hace ideal para granjear recursos de aldeas inactivas.',
                  type: 'infantry',
                  role: 'versatile',
                  cost: { wood: 45, stone: 60, iron: 30, food: 15 },
                  upkeep: 1,
                  stats: { attack: 10, defense: { infantry: 30, cavalry: 20 }, speed: 7, capacity: 15 },
                  trainTime: 530,
                  research: { requires: { barracks: 1 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'ash_warden_egypt',
                  name: 'Guardia de Ceniza',
                  description: 'Una unidad defensiva extremadamente poderosa y eficiente, el baluarte de cualquier defensa egipcia.',
                  type: 'infantry',
                  role: 'defensive',
                  cost: { wood: 115, stone: 100, iron: 145, food: 60 },
                  upkeep: 1,
                  stats: { attack: 30, defense: { infantry: 55, cavalry: 40 }, speed: 6, capacity: 50 },
                  trainTime: 1320,
                  research: { requires: { academy: 1, smithy: 1 }, cost: { wood: 2400, stone: 2600, iron: 3200, food: 1900 }, time: 4400 }
              },
              {
                  id: 'khopesh_warrior_egypt',
                  name: 'Guerrero Khopesh',
                  description: 'Infantería de élite con un ataque formidable, diseñada para romper las líneas enemigas.',
                  type: 'infantry',
                  role: 'offensive',
                  cost: { wood: 170, stone: 180, iron: 220, food: 80 },
                  upkeep: 1,
                  stats: { attack: 65, defense: { infantry: 50, cavalry: 20 }, speed: 7, capacity: 45 },
                  trainTime: 1440,
                  research: { requires: { academy: 3, smithy: 1 }, cost: { wood: 4800, stone: 5500, iron: 6900, food: 3600 }, time: 7500 }
              },
              {
                  id: 'sopdu_explorer_egypt',
                  name: 'Explorador de Sopdu',
                  description: 'Espía egipcio, bendecido por los dioses para moverse sin ser visto.',
                  type: 'scout',
                  role: 'scout',
                  cost: { wood: 170, stone: 150, iron: 20, food: 40 },
                  upkeep: 2,
                  stats: { attack: 0, defense: { infantry: 20, cavalry: 10 }, speed: 16, capacity: 0 },
                  trainTime: 1360,
                  research: { requires: { academy: 1, stable: 1 }, cost: { wood: 3500, stone: 3800, iron: 1600, food: 2100 }, time: 4100 }
              },
              {
                  id: 'anhur_guard_egypt',
                  name: 'Guardia de Anhur',
                  description: 'Caballería pesada y defensiva. Un muro montado que protege las tierras del faraón.',
                  type: 'cavalry',
                  role: 'defensive',
                  cost: { wood: 360, stone: 330, iron: 280, food: 120 },
                  upkeep: 2,
                  stats: { attack: 50, defense: { infantry: 110, cavalry: 50 }, speed: 15, capacity: 50 },
                  trainTime: 2560,
                  research: { requires: { academy: 5, stable: 5 }, cost: { wood: 9100, stone: 7800, iron: 6100, food: 4800 }, time: 10100 }
              },
              {
                  id: 'resheph_chariot_egypt',
                  name: 'Carro de Resheph',
                  description: 'La unidad más poderosa del ejército egipcio. Un carro de guerra que combina velocidad y una potencia de fuego devastadora.',
                  type: 'cavalry',
                  role: 'offensive',
                  cost: { wood: 450, stone: 560, iron: 610, food: 180 },
                  upkeep: 3,
                  stats: { attack: 110, defense: { infantry: 120, cavalry: 150 }, speed: 10, capacity: 70 },
                  trainTime: 3240,
                  research: { requires: { academy: 5, stable: 10 }, cost: { wood: 11800, stone: 11100, iron: 14200, food: 6200 }, time: 14800 }
              },
              {
                  id: 'ram_egypt',
                  name: 'Ariete',
                  description: 'Máquina de asedio egipcia, construida para resistir el paso del tiempo y de las flechas.',
                  type: 'siege',
                  role: 'ram',
                  cost: { wood: 995, stone: 575, iron: 340, food: 80 },
                  upkeep: 3,
                  stats: { attack: 55, defense: { infantry: 30, cavalry: 95 }, speed: 4, capacity: 0 },
                  trainTime: 4800,
                  research: { requires: { academy: 10, workshop: 1 }, cost: { wood: 13100, stone: 8500, iron: 6500, food: 3400 }, time: 11000 }
              },
              {
                  id: 'catapult_egypt',
                  name: 'Catapulta de Piedra',
                  description: 'Una obra de ingeniería precisa, capaz de lanzar proyectiles a gran distancia con notable exactitud.',
                  type: 'siege',
                  role: 'catapult',
                  cost: { wood: 980, stone: 1510, iron: 660, food: 100 },
                  upkeep: 6,
                  stats: { attack: 65, defense: { infantry: 55, cavalry: 10 }, speed: 3, capacity: 0 },
                  trainTime: 9000,
                  research: { requires: { academy: 15, workshop: 10 }, cost: { wood: 15100, stone: 19500, iron: 11100, food: 3800 }, time: 19800 }
              },
              {
                  id: 'nomarch_egypt',
                  name: 'Nomarca',
                  description: 'Un gobernador con la autoridad del faraón, capaz de anexionar nuevas tierras al imperio.',
                  type: 'chief',
                  role: 'conquest',
                  cost: { wood: 34000, stone: 50000, iron: 34000, food: 42000 },
                  upkeep: 4,
                  stats: { attack: 40, defense: { infantry: 50, cavalry: 50 }, speed: 4, capacity: 0 },
                  trainTime: 90700,
                  research: { requires: { academy: 15, rallyPoint: 10 }, cost: { wood: 55000, stone: 41000, iron: 41000, food: 45000 }, time: 28000 }
              },
              {
                  id: 'settler_egypt',
                  name: 'Colono',
                  description: 'Valientes ciudadanos que viajan para fundar una nueva aldea en tu nombre.',
                  type: 'settler',
                  role: 'colonization',
                  cost: { wood: 3000, stone: 4560, iron: 5890, food: 4370 },
                  upkeep: 1,
                  stats: { attack: 0, defense: { infantry: 80, cavalry: 80 }, speed: 5, capacity: 3000 },
                  trainTime: 24800,
                  research: { requires: { palace: 10 }, cost: { wood: 0, stone: 0, iron: 0, food: 0 }, time: 0 }
              },
              {
                  id: 'merchant_egyptian',
                  name: 'Mercader',
                  type: 'merchant',
                  role: 'trade',
                  upkeep: 2,
                  stats: { speed: 16, capacity: 750 },
              }
          ]
      },
      nature: {
          name: 'Naturaleza',
          description: 'Las criaturas salvajes que habitan los oasis y ruinas del mundo. No son una facción jugable.',
          troops: [
              {
                  id: 'rat', name: 'Rata', type: 'infantry', role: 'defensive', upkeep: 1, heroXp: 1,
                  stats: { attack: 10, defense: { infantry: 25, cavalry: 20 }, speed: 7, capacity: 45 }
              },
              {
                  id: 'spider', name: 'Araña', type: 'infantry', role: 'defensive', upkeep: 1, heroXp: 2,
                  stats: { attack: 20, defense: { infantry: 35, cavalry: 40 }, speed: 7, capacity: 65 }
              },
              {
                  id: 'snake', name: 'Serpiente', type: 'infantry', role: 'versatile', upkeep: 1, heroXp: 3,
                  stats: { attack: 60, defense: { infantry: 40, cavalry: 60 }, speed: 6, capacity: 80 }
              },
              {
                  id: 'bat', name: 'Murciélago', type: 'cavalry', role: 'defensive', upkeep: 1, heroXp: 4,
                  stats: { attack: 10, defense: { infantry: 66, cavalry: 50 }, speed: 9, capacity: 0 }
              },
              {
                  id: 'wild_boar', name: 'Jabalí', type: 'infantry', role: 'versatile', upkeep: 2, heroXp: 5,
                  stats: { attack: 50, defense: { infantry: 70, cavalry: 33 }, speed: 10, capacity: 120 }
              },
              {
                  id: 'wolf', name: 'Lobo', type: 'cavalry', role: 'offensive', upkeep: 2, heroXp: 8,
                  stats: { attack: 100, defense: { infantry: 80, cavalry: 70 }, speed: 9, capacity: 150 }
              },
              {
                  id: 'bear', name: 'Oso', type: 'infantry', role: 'versatile', upkeep: 3, heroXp: 15,
                  stats: { attack: 250, defense: { infantry: 140, cavalry: 200 }, speed: 4, capacity: 125 }
              },
              {
                  id: 'crocodile', name: 'Cocodrilo', type: 'infantry', role: 'offensive', upkeep: 3, heroXp: 20,
                  stats: { attack: 450, defense: { infantry: 380, cavalry: 240 }, speed: 3, capacity: 0 }
              },
              {
                  id: 'tiger', name: 'Tigre', type: 'cavalry', role: 'offensive', upkeep: 3, heroXp: 25,
                  stats: { attack: 200, defense: { infantry: 170, cavalry: 250 }, speed: 5, capacity: 0 }
              },
              {
                  id: 'elephant', name: 'Elefante', type: 'cavalry', role: 'offensive', upkeep: 5, heroXp: 50,
                  stats: { attack: 600, defense: { infantry: 440, cavalry: 520 }, speed: 5, capacity: 3000 }
              }
          ]
      },
      natars: {
          name: 'Natares',
          description: 'Una antigua y misteriosa raza que despierta en la fase final del juego para desafiar a todos los imperios. Sus tropas son legendarias y extremadamente poderosas. No son jugables.',
          troops: [
              {
                  id: 'pikeman_natars', name: 'Piquero', type: 'infantry', role: 'defensive', upkeep: 1, heroXp: 10,
                  stats: { attack: 20, defense: { infantry: 35, cavalry: 50 }, speed: 10, capacity: 25 }
              },
              {
                  id: 'thorned_warrior_natars', name: 'Guerrero Espinoso', type: 'infantry', role: 'offensive', upkeep: 1, heroXp: 12,
                  stats: { attack: 65, defense: { infantry: 30, cavalry: 10 }, speed: 9, capacity: 55 }
              },
              {
                  id: 'guardsman_natars', name: 'Guardia', type: 'infantry', role: 'versatile', upkeep: 1, heroXp: 15,
                  stats: { attack: 100, defense: { infantry: 90, cavalry: 75 }, speed: 15, capacity: 60 }
              },
              {
                  id: 'birds_of_prey_natars', name: 'Ave de Rapiña', type: 'scout', role: 'scout', upkeep: 2, heroXp: 5,
                  stats: { attack: 0, defense: { infantry: 10, cavalry: 0 }, speed: 20, capacity: 0 }
              },
              {
                  id: 'axerider_natars', name: 'Jinete de Hacha', type: 'cavalry', role: 'offensive', upkeep: 2, heroXp: 20,
                  stats: { attack: 155, defense: { infantry: 80, cavalry: 50 }, speed: 22, capacity: 80 }
              },
              {
                  id: 'natarian_knight_natars', name: 'Caballero Natar', type: 'cavalry', role: 'versatile', upkeep: 2, heroXp: 30,
                  stats: { attack: 170, defense: { infantry: 140, cavalry: 80 }, speed: 20, capacity: 45 }
              },
              {
                  id: 'war_elephant_natars', name: 'Elefante de Guerra', type: 'ram', role: 'offensive', upkeep: 3, heroXp: 100,
                  stats: { attack: 250, defense: { infantry: 120, cavalry: 150 }, speed: 17, capacity: 55 }
              },
              {
                  id: 'ballista_natars', name: 'Balista', type: 'siege', role: 'catapult', upkeep: 0, heroXp: 80,
                  stats: { attack: 60, defense: { infantry: 45, cavalry: 10 }, speed: 0, capacity: 0 }
              },
              {
                  id: 'natarian_emperor_natars', name: 'Emperador Natar', type: 'chief', role: 'conquest', upkeep: 0, heroXp: 500,
                  stats: { attack: 80, defense: { infantry: 50, cavalry: 50 }, speed: 0, capacity: 0 }
              },
              {
                  id: 'settler_natars', name: 'Colono', type: 'settler', role: 'colonization', upkeep: 0, heroXp: 0,
                  stats: { attack: 30, defense: { infantry: 40, cavalry: 40 }, speed: 0, capacity: 0 }
              }
        ]
      }
    }
