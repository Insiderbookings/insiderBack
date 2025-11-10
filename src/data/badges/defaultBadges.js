// src/data/badges/defaultBadges.js

export const DEFAULT_BADGES = [
  {
    slug: "host_superhost",
    scope: "HOST",
    title: "Superanfitrion",
    subtitle: "Resenas destacadas y experiencia comprobada",
    description:
      "Los superanfitriones mantienen calificaciones altas, experiencia constante y ofrecen hospedajes confiables para los huespedes.",
    icon: "star-sharp",
    priority: 100,
    criteria: {
      minOverallRating: 4.8,
      minCompletedStays: 10,
      maxCancellationRate: 0.01,
    },
  },
  {
    slug: "home_top_rated_10",
    scope: "HOME",
    title: "En el 10% de los alojamientos mejor calificados",
    subtitle: "Los huespedes resaltan su experiencia",
    description:
      "Este alojamiento se encuentra entre los mejores de la plataforma segun sus evaluaciones y comentarios.",
    icon: "trophy",
    priority: 90,
    criteria: {
      percentile: 0.1,
      minReviews: 20,
      minRating: 4.8,
    },
  },
  {
    slug: "home_exceptional_checkin",
    scope: "HOME",
    title: "Experiencia de llegada excepcional",
    subtitle: "Llegada simple y bien evaluada",
    description:
      "Los huespedes recientes calificaron el proceso de llegada con 5 estrellas en promedio.",
    icon: "log-in",
    priority: 80,
    criteria: {
      minCheckInRating: 4.9,
      minReviews: 5,
    },
  },
  {
    slug: "home_private_room",
    scope: "HOME",
    title: "Habitacion en vivienda rentada",
    subtitle: "Espacio privado dentro de una vivienda compartida",
    description:
      "Una habitacion solo para ti dentro de un alojamiento con acceso a areas compartidas.",
    icon: "home",
    priority: 70,
    criteria: {
      spaceType: "PRIVATE_ROOM",
    },
  },
  {
    slug: "home_entire_place",
    scope: "HOME",
    title: "Alojamiento entero",
    subtitle: "Total privacidad durante tu estadia",
    description:
      "Disfrutaras de todo el alojamiento para ti solo, sin areas compartidas con otros huespedes.",
    icon: "home-sharp",
    priority: 65,
    criteria: {
      spaceType: "ENTIRE_PLACE",
    },
  },
];
