import test from "node:test";
import assert from "node:assert/strict";
import { buildEffectivePartnerHotelProfile } from "../../src/services/partnerHotelProfile.service.js";

const baseItem = {
  hotelId: "42",
  name: "Hotel Base",
  shortDescription: "Provider description",
  coverImage: "https://provider.example/cover.jpg",
  images: [
    { url: "https://provider.example/cover.jpg", categoryName: "General" },
    { url: "https://provider.example/gallery-2.jpg", categoryName: "General" },
  ],
  amenities: [
    { name: "Pool", category: "General" },
    { name: "Gym", category: "Leisure" },
  ],
  contact: {
    phone: "+1 305 000 0000",
    checkIn: "15:00",
    checkOut: "11:00",
  },
};

test("active partner profile overrides public description, gallery, and premium fields", () => {
  const effective = buildEffectivePartnerHotelProfile({
    item: baseItem,
    claim: {
      claim_status: "SUBSCRIBED",
    },
    partnerProgram: {
      capabilities: {
        basicProfile: true,
        fullProfileEditor: true,
        bookingInquiry: true,
        responseTimeBadge: true,
        specialOffers: true,
      },
    },
    profile: {
      id: 1,
      status: "ACTIVE",
      headline: "Partner headline",
      description_override: "Partner description",
      contact_email: "sales@partner.example",
      inquiry_enabled: true,
      response_time_badge_enabled: true,
      response_time_badge_label: "Usually replies in under 1 hour",
      special_offers_enabled: true,
      special_offers_title: "Spring package",
      special_offers_body: "Includes breakfast and late checkout",
      profileImages: [
        {
          source_type: "provider",
          provider_image_url: "https://provider.example/gallery-2.jpg",
          image_url: "https://provider.example/gallery-2.jpg",
          caption: "Lobby",
          sort_order: 1,
          is_cover: false,
          is_active: true,
        },
        {
          source_type: "provider",
          provider_image_url: "https://provider.example/cover.jpg",
          image_url: "https://provider.example/cover.jpg",
          caption: "Facade",
          sort_order: 0,
          is_cover: true,
          is_active: true,
        },
      ],
      profileAmenities: [
        {
          source_type: "provider",
          provider_category: "General",
          label: "Infinity pool",
          sort_order: 0,
          is_highlighted: true,
          is_active: true,
        },
      ],
    },
  });

  assert.equal(effective.headline, "Partner headline");
  assert.equal(effective.description, "Partner description");
  assert.equal(effective.coverImage, "https://provider.example/cover.jpg");
  assert.equal(effective.gallery.length, 2);
  assert.equal(effective.gallery[0].url, "https://provider.example/cover.jpg");
  assert.equal(effective.amenities[0].label, "Infinity pool");
  assert.equal(effective.contact.email, "sales@partner.example");
  assert.equal(effective.bookingInquiry?.ctaLabel, "Send inquiry");
  assert.equal(effective.responseTimeBadge?.label, "Usually replies in under 1 hour");
  assert.equal(effective.specialOffers?.title, "Spring package");
});

test("public surfaces fall back to provider content when the current plan does not allow profile overrides", () => {
  const effective = buildEffectivePartnerHotelProfile({
    item: baseItem,
    partnerProgram: {
      capabilities: {
        basicProfile: false,
        responseTimeBadge: false,
        specialOffers: false,
      },
    },
    profile: {
      id: 2,
      status: "ACTIVE",
      headline: "Hidden partner headline",
      description_override: "Hidden partner description",
      response_time_badge_enabled: true,
      response_time_badge_label: "Fast reply",
      special_offers_enabled: true,
      special_offers_title: "Hidden offer",
      profileImages: [
        {
          source_type: "provider",
          provider_image_url: "https://provider.example/gallery-2.jpg",
          image_url: "https://provider.example/gallery-2.jpg",
          sort_order: 0,
          is_cover: true,
          is_active: true,
        },
      ],
      profileAmenities: [
        {
          source_type: "provider",
          provider_category: "General",
          label: "Hidden amenity",
          sort_order: 0,
          is_highlighted: true,
          is_active: true,
        },
      ],
    },
  });

  assert.equal(effective.headline, "Hotel Base");
  assert.equal(effective.description, "Provider description");
  assert.equal(effective.coverImage, "https://provider.example/cover.jpg");
  assert.equal(effective.gallery.length, 2);
  assert.equal(effective.amenities[0].label, "Pool");
  assert.equal(effective.bookingInquiry, null);
  assert.equal(effective.responseTimeBadge, null);
  assert.equal(effective.specialOffers, null);
});

test("verified keeps story/contact overrides but does not unlock the full gallery and amenity editor", () => {
  const effective = buildEffectivePartnerHotelProfile({
    item: baseItem,
    partnerProgram: {
      capabilities: {
        basicProfile: true,
        fullProfileEditor: false,
        responseTimeBadge: false,
        specialOffers: false,
      },
    },
    profile: {
      id: 3,
      status: "ACTIVE",
      headline: "Verified headline",
      description_override: "Verified description",
      contact_email: "frontdesk@verified.example",
      profileImages: [
        {
          source_type: "provider",
          provider_image_url: "https://provider.example/gallery-2.jpg",
          image_url: "https://provider.example/gallery-2.jpg",
          caption: "Hidden custom gallery",
          sort_order: 0,
          is_cover: true,
          is_active: true,
        },
      ],
      profileAmenities: [
        {
          source_type: "provider",
          provider_category: "General",
          label: "Hidden custom amenity",
          sort_order: 0,
          is_highlighted: true,
          is_active: true,
        },
      ],
    },
  });

  assert.equal(effective.headline, "Verified headline");
  assert.equal(effective.description, "Verified description");
  assert.equal(effective.contact.email, "frontdesk@verified.example");
  assert.equal(effective.gallery.length, 2);
  assert.equal(effective.gallery[0].url, "https://provider.example/cover.jpg");
  assert.equal(effective.amenities[0].label, "Pool");
});
