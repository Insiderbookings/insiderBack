// src/data/badges/defaultBadges.js

export const DEFAULT_BADGES = [
  {
    slug: "host_superhost",
    scope: "HOST",
    title: "Superhost",
    subtitle: "Top reviews and proven hosting experience",
    description:
      "Superhosts keep outstanding ratings, consistent experience, and provide reliable stays for guests.",
    icon: "star-sharp",
    priority: 100,
    criteria: {
      minOverallRating: 4.8,
      minCompletedStays: 10,
      maxCancellationRate: 0.01,
    },
  },
  {
    slug: "host_verified",
    scope: "HOST",
    title: "Verified host",
    subtitle: "Identity verified on the platform",
    description:
      "This host completed verification and meets Insider identity requirements.",
    icon: "checkmark-circle",
    priority: 95,
    criteria: {
      kycStatus: "APPROVED",
    },
  },
  {
    slug: "home_top_rated_10",
    scope: "HOME",
    title: "Top 10% rated homes",
    subtitle: "Guests highlight this experience",
    description:
      "This home is among the top-rated stays on the platform based on guest reviews.",
    icon: "trophy",
    priority: 90,
    criteria: {
      percentile: 0.1,
      minReviews: 20,
      minRating: 4.8,
    },
  },
  {
    slug: "home_free_cancellation",
    scope: "HOME",
    title: "Flexible cancellation",
    subtitle: "Full refund within the allowed window",
    description:
      "This property offers flexible cancellation based on the policy shown at booking.",
    icon: "calendar-clear",
    priority: 85,
    criteria: {
      cancellationPolicy: "FLEXIBLE",
    },
  },
  {
    slug: "home_exceptional_checkin",
    scope: "HOME",
    title: "Exceptional check-in",
    subtitle: "Smooth, highly rated arrival",
    description:
      "Recent guests rated the arrival experience 5 stars on average.",
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
    title: "Private room",
    subtitle: "Private space inside a shared home",
    description:
      "A room just for you with access to shared areas.",
    icon: "home",
    priority: 70,
    criteria: {
      spaceType: "PRIVATE_ROOM",
    },
  },
  {
    slug: "home_entire_place",
    scope: "HOME",
    title: "Entire place",
    subtitle: "Full privacy during your stay",
    description:
      "Enjoy the entire home to yourself, with no shared spaces.",
    icon: "home-sharp",
    priority: 65,
    criteria: {
      spaceType: "ENTIRE_PLACE",
    },
  },
];
