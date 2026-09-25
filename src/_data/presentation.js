// Presentation metadata only. LinkedIn text stays in linkedin.js.
const studioContent = require('./studioContent.json');

const basePresentation = {
  'bc2': {
    section: 'project',
    displayTitle: 'BC2'
  },
  'component-keepouts': {
    date: '2024-11-02',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7258385631699976192/',
    image: '/assets/images/posts/component-keepouts/01-field-path.jpg',
    alt: 'PCB signal field interacting with a resistor body and continuous ground conductor',
    images: [
      {
        src: '/assets/images/posts/component-keepouts/01-field-path.jpg',
        alt: 'PCB signal field interacting with a resistor body and continuous ground conductor'
      },
      {
        src: '/assets/images/posts/component-keepouts/02-cleaning-clearance.jpg',
        alt: 'Component cross sections and QFN examples showing clearance for cleaning flux residues'
      }
    ],
    fit: 'contain'
  },
  'circuit-protection': {
    date: '2026-05-09',
    sourceUrl: 'https://www.linkedin.com/posts/anasmalas_lets-go-on-a-journey-and-look-at-different-activity-7458816725103521792-_Bdd',
    image: '/assets/images/posts/circuit-protection/01-protection-ic-comparison.jpg',
    alt: 'Comparison chart of integrated circuits that provide reverse-voltage, reverse-current, and related circuit protections',
    images: [
      {
        src: '/assets/images/posts/circuit-protection/01-protection-ic-comparison.jpg',
        alt: 'Comparison chart of integrated circuits that provide reverse-voltage, reverse-current, and related circuit protections'
      }
    ],
    fit: 'contain'
  },
  'return-current': {
    date: '2022-12-19',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7010651170159394816/',
    image: '/assets/images/posts/return-current/01-return-current.jpg',
    alt: 'PCB cross section illustrating a high-frequency return current path',
    images: [
      {
        src: '/assets/images/posts/return-current/01-return-current.jpg',
        alt: 'PCB cross section illustrating a high-frequency return current path'
      }
    ],
    fit: 'contain'
  },
  'return-currents': {
    date: '2022-11-13',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:6997511010337099776/',
    image: '/assets/images/posts/return-currents/01-cover.jpg',
    alt: 'Circuit board cross section with return-current guidance',
    images: [
      {
        src: '/assets/images/posts/return-currents/01-cover.jpg',
        alt: 'Circuit board cross section with return-current guidance'
      },
      {
        src: '/assets/images/posts/return-currents/02-10-layer-stackup.jpg',
        alt: '10 layer good stackup'
      },
      {
        src: '/assets/images/posts/return-currents/03-bad-4-layer-stackup.jpg',
        alt: 'Bad 4 layer stackup'
      },
      {
        src: '/assets/images/posts/return-currents/04-good-4-layer-stackup.jpg',
        alt: 'Good 4 layer stackup'
      }
    ],
    fit: 'contain'
  },
  'gan': {
    date: '2022-11-07',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:6995303105990942720/',
    image: '/assets/images/posts/gan/01-gan-power-converter.jpg',
    alt: 'A small 1 kW GaN power converter shown beside its power-density claim',
    images: [
      {
        src: '/assets/images/posts/gan/01-gan-power-converter.jpg',
        alt: 'A small 1 kW GaN power converter shown beside its power-density claim'
      }
    ],
    fit: 'contain'
  },
  'pink-esd': {
    date: '2022-11-03',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:6993902327266992128/',
    image: '/assets/images/posts/pink-esd/01-pink-esd-presentation.jpg',
    alt: 'Presentation image about pink ESD protective bags',
    images: [
      {
        src: '/assets/images/posts/pink-esd/01-pink-esd-presentation.jpg',
        alt: 'Presentation image about pink ESD protective bags'
      }
    ],
    fit: 'contain'
  },
  'differential-pairs': {
    date: '2022-10-29',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:6992054289644834816/',
    image: '/assets/images/posts/differential-pairs/01-differential-pairs.jpg',
    alt: 'Differential-pair routing examples on a PCB',
    images: [
      {
        src: '/assets/images/posts/differential-pairs/01-differential-pairs.jpg',
        alt: 'Differential-pair routing examples on a PCB'
      }
    ],
    fit: 'contain'
  },
  'resistor-arrays': {
    date: '2022-10-23',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:6989957912437637120/',
    image: '/assets/images/posts/resistor-arrays/01-ram-resistor-arrays.jpg',
    alt: 'Close comparison of individual resistors and a four-resistor array',
    images: [
      {
        src: '/assets/images/posts/resistor-arrays/01-ram-resistor-arrays.jpg',
        alt: 'Close comparison of individual resistors and a four-resistor array'
      },
      {
        src: '/assets/images/posts/resistor-arrays/02-price-comparison.jpg',
        alt: 'Price comparison of four-resistor arrays and individual resistor chips'
      },
      {
        src: '/assets/images/posts/resistor-arrays/03-matching-tolerance.jpg',
        alt: 'Comparison of resistor matching ratio and resistor-ratio drift'
      }
    ],
    fit: 'contain'
  },
  'business-card-competition': {
    section: 'hidden',
    date: '2025-12-31',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7411940505871089664/'
  },
  'hotel-fridge': {
    date: '2022-09-16',
    sourceUrl: 'https://www.linkedin.com/posts/anasmalas_electronics-costreduction-bomoptimization-activity-6976462523403264000-Qjrd',
    image: '/assets/images/posts/hotel-fridge/01-ir-door-sensor.jpg',
    alt: 'Infrared door sensor and light assembly from a hotel mini fridge',
    images: [
      {
        src: '/assets/images/posts/hotel-fridge/01-ir-door-sensor.jpg',
        alt: 'Infrared LED and receiver used to detect whether the mini-fridge door is closed'
      },
      {
        src: '/assets/images/posts/hotel-fridge/02-fridge-light-pcb.jpg',
        alt: 'Single-layer mini-fridge light PCB held in its plastic enclosure without screws'
      },
      {
        src: '/assets/images/posts/hotel-fridge/03-rast-connector-price.jpg',
        alt: 'Distributor pricing shown for the RAST 2.5 insulation-displacement connector'
      }
    ]
  },
  'uninterrupted-usb-pd': {
    section: 'open-source',
    displayTitle: 'USB PD Nexus',
    date: '2024-07-01',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7213491353291223040/',
    image: '/assets/images/posts/uninterrupted-usb-pd/01-usb-pd-board.jpg',
    alt: 'USB Power Delivery board with multiple power inputs',
    images: [
      {
        src: '/assets/images/posts/uninterrupted-usb-pd/01-usb-pd-board.jpg',
        alt: 'USB Power Delivery board with multiple power inputs'
      }
    ],
    fit: 'contain',
    repo: 'https://github.com/tiiuae/tii-nexus-usb-pd'
  },
  'negotiator': {
    section: 'project',
    displayTitle: 'The Negotiator',
    date: '2025-09-26',
    sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7377190388052332545/',
    image: '/assets/images/posts/negotiator/01-card-front.jpg',
    alt: 'PCB contact card made for PCB West',
    images: [
      {
        src: '/assets/images/posts/negotiator/01-card-front.jpg',
        alt: 'PCB contact card made for PCB West'
      },
      {
        src: '/assets/images/posts/negotiator/02-card-back.jpg',
        alt: 'Back of the PCB contact card made for PCB West'
      },
      {
        src: '/assets/images/posts/negotiator/03-card-detail.jpg',
        alt: 'Detail of the PCB contact card and its components'
      }
    ],
    fit: 'contain'
  },
  'usb-c-edge': {
    section: 'open-source',
    relatedUrl: '/articles/usb-c-tests/',
    relatedLabel: 'Connector reliability article',
    date: '2025-10-25',
    sourceUrl: 'https://www.linkedin.com/posts/anasmalas_what-does-it-take-to-make-the-slimmest-possible-activity-7387799941340979200-p10Q',
    image: '/assets/images/posts/usb-c-edge/01-pcb-type-c.jpg',
    alt: 'PCB edge USB-C connector test board',
    repo: 'https://github.com/AnasMalas/pcb-edge-usb-c'
  },
  'usb-c-tests': {
    section: 'article',
    relatedUrl: '/open-source/usb-c-edge/',
    relatedLabel: 'Open-source connector',
    date: '2025-10-29',
    sourceUrl: 'https://www.linkedin.com/posts/anasmalas_compromises-and-trade-offs-are-an-important-activity-7389150556499554304-N_r_',
    image: '/assets/images/posts/usb-c-tests/01-thermal-test.jpg',
    alt: 'Thermal test of the PCB edge USB-C connector',
    repo: 'https://github.com/AnasMalas/pcb-edge-usb-c'
  }
};

module.exports = Object.fromEntries(Object.entries(basePresentation).map(([slug, metadata]) => [
  slug,
  { ...metadata, ...(studioContent.posts?.[slug]?.presentation || {}) }
]));
