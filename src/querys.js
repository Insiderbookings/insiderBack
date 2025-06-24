INSERT INTO public."AddOn"
       (name, description, price,
        created_at,          updated_at,          deleted_at)
VALUES ('Late Checkout',
        'Permite a los huéspedes hacer late checkout hasta las 16:00 horas.',
        45.60,
        '2025-05-16 03:34:39.644522-03',
        '2025-05-16 03:34:39.644522-03',
        NULL);


///-------///

NSERT INTO public."Hotel"
      (name, description, address, city, country, star_rating,
       created_at,             updated_at,             deleted_at,
       location, image, rating, price, category,
       lat,      lng,  phone,  amenities)
VALUES
/* 11 ─ Catalina Hotel & Beach Club ─────────────*/
('Catalina Hotel & Beach Club',
 'A beachfront hotel and club located on Miami Beach, offering luxury amenities including two outdoor pools, multiple dining venues, in-room comforts, 24/7 services and a pet-friendly policy.',
 '1732 Collins Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', 4,
 '2025-05-23 18:30:56.516565-03', '2025-05-23 18:30:56.516565-03', NULL,
 'Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748036510/catalinaHotel_a4ukry.jpg',
 4.5, 350.00, 'featured',
 25.791500, -80.128800, '(305) 674-1160', $${
   "pools": ["rooftop pool", "bamboo pool", "cabanas", "loungers"],
   "dining": ["Maxine's Bistro & Bar", "Taco Taco South Beach", "coffee shop", "poolside bar"],
   "in_room": ["Egyptian cotton sheets", "memory foam beds", "blackout curtains", "minibar", "plasma TV", "designer toiletries"],
   "services": ["Free Wi-Fi", "24/7 front desk", "concierge", "laundry", "ATM", "elevator", "rooftop terrace"],
   "pet_policy": {"dogs": "max 2 per room (hasta 40 lbs)", "deposit": "$250 por estadía", "exemptions": "service animals"}
}$$::jsonb),

/* 12 ─ Hotel Croydon ──────────────────────────*/
('Hotel Croydon',
 NULL,
 '3720 Collins Avenue, Miami Beach, FL 33140',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'Mid-Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041878/hotel_croydon_amvtzq.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 938-1145', $${
   "pools": ["Rooftop sun deck with ocean and city views", "Outdoor pool with loungers"],
   "dining": ["The Tavern (8 AM – 11 PM)"],
   "in_room": ["42\" plasma TVs with cable", "Memory foam beds with Egyptian cotton linens", "iHome docking stations", "Minibar and mini-fridge in every room"],
   "services": ["Free Wi-Fi throughout the hotel", "Fitness center and spa services", "Daily housekeeping", "Complimentary beach towels", "Free Happy Hour (7 PM – 8 PM)", "Free airport shuttle to/from Miami International Airport", "Multilingual staff: English, Spanish, French, Croatian, Russian"]
}$$::jsonb),

/* 13 ─ Riviera Hotel South Beach ──────────────*/
('Riviera Hotel South Beach',
 NULL,
 '318 20th Street, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041905/rivera_hotel_ktpi1o.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 538-7444', $${
   "pools": ["Rooftop pool with city views", "Courtyard pool with cabanas"],
   "dining": ["Mas Cuba Café & Bar"],
   "in_room": ["Fully equipped kitchens in suites with gourmet cooktops and stainless steel appliances", "42\" plasma TVs with cable channels", "Egyptian cotton sheets and pillowtop mattresses", "Rain shower heads in bathrooms"],
   "services": ["Complimentary Wi-Fi throughout the property", "Daily housekeeping services", "Business center and meeting rooms", "Concierge services and 24-hour front desk", "Complimentary airport shuttle service to and from Miami International Airport", "Complimentary cocktail hour from 7 PM to 8 PM", "Multilingual staff"]
}$$::jsonb),

/* 14 ─ Tradewinds Apartment Hotel ────────────*/
('Tradewinds Apartment Hotel',
 NULL,
 '2365 Pinetree Drive, Miami Beach, FL 33140',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'Mid-Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041937/tradewionds_hotel_xan9re.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 531-6795', $${
   "pools": ["Outdoor swimming pool with sun loungers"],
   "dining": [],
   "in_room": ["Fully equipped kitchens in all suites", "42\" plasma TVs with satellite channels", "In-room safes"],
   "services": ["Lush courtyards and picnic areas", "Free Wi-Fi throughout the property", "Free beach towels", "Complimentary coffee (8–10 AM in the lobby)", "Wine tasting (1–5 PM)", "Free happy hour at Maxine’s Bistro & Bar (5–6 PM)", "Daily towel and trash service; full housekeeping every third day", "24-hour front desk and concierge", "On-site laundry", "ATM on property", "Designated smoking areas", "Pet-friendly accommodations"]
}$$::jsonb),

/* 15 ─ Lincoln Arms Suites ───────────────────*/
('Lincoln Arms Suites',
 NULL,
 '1800 James Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041959/lincoln_arms_oebmys.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(786) 541-2125', $${
   "pools": [],
   "dining": [],
   "in_room": ["Fully equipped kitchens in all suites", "42\" plasma TVs with cable", "In-room safe"],
   "services": ["Free Wi-Fi throughout the property", "Air conditioning", "Daily housekeeping service", "Sun terrace and garden", "Complimentary beach towels", "24-hour front desk and concierge services", "ATM on-site", "Smoke-free property", "Pet-friendly accommodations"]
}$$::jsonb),

/* 16 ─ Chesterfield Hotel & Suites ───────────*/
('Chesterfield Hotel & Suites',
 NULL,
 '855 Collins Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041977/chesterfield_hotel_gznkgp.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 531-5831', $${
   "pools": [],
   "dining": ["Safari Bar (on-site)"],
   "in_room": ["Plasma TVs with cable channels", "iPod docking stations", "Minibar in rooms", "Egyptian cotton linens and pillowtop beds", "Designer toiletries in bathrooms"],
   "services": ["Free Wi-Fi throughout the property", "24-hour front desk and concierge services", "Complimentary beach towels", "Outdoor patio and garden area", "Air conditioning", "Daily housekeeping services", "ATM on-site", "Smoke-free property", "Elevator access"]
}$$::jsonb),

/* 17 ─ Hotel Shelley ─────────────────────────*/
('Hotel Shelley',
 NULL,
 '844 Collins Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748041999/hotel_shelley_dsh98o.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 531-3341', $${
   "pools": [],
   "dining": [],
   "in_room": ["32\" plasma TVs with satellite service", "Mini bar and mini refrigerator", "In-room safe", "Marble bathrooms with hairdryer and bath products"],
   "services": ["Free premium Wi-Fi", "Complimentary coffee in the lobby (8–10 AM)", "Free happy hour at Maxine’s Bistro & Bar (5–6 PM)", "Complimentary beach towels", "Daily towel replenishment and trash pick-up; full housekeeping every third day", "24-hour front desk and concierge services", "ATM on-site", "Smoke-free property"]
}$$::jsonb),

/* 18 ─ Hotel Chelsea ─────────────────────────*/
('Hotel Chelsea',
 NULL,
 '944 Washington Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042269/hotel_chelsea_ujvoga.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 534-4069', $${
   "pools": [],
   "dining": ["Habana Vieja"],
   "in_room": ["42\" plasma TVs with cable", "Mini refrigerator in rooms", "In-room safe", "Designer toiletries in bathrooms"],
   "services": ["Free Wi-Fi throughout the property", "Outdoor patio seating area", "Daily housekeeping service", "24-hour front desk and concierge", "ATM on-site", "Smoke-free property"]
}$$::jsonb),

/* 19 ─ Whitelaw Hotel ────────────────────────*/
('Whitelaw Hotel',
 NULL,
 '808 Collins Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042299/Whitelaw_hotel_xza4d1.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 398-7000', $${
   "pools": [],
   "dining": ["Free happy hour at Maxine’s Bistro & Bar (5–6 PM)"],
   "in_room": ["Mini bar and mini refrigerator", "In-room safe", "42\" plasma TVs with satellite service", "Stereo with iPod docking station", "Alarm clock", "Iron & ironing board", "Hair dryer"],
   "services": ["Free Wi-Fi throughout the property", "Complimentary beach towels", "Marble bathrooms with designer toiletries", "24-hour front desk and concierge services", "ATM on-site", "Smoke-free property"]
}$$::jsonb),

/* 20 ─ Beachside All Suites Hotel ───────────*/
('Beachside All Suites Hotel',
 NULL,
 '7500 Collins Avenue, Miami Beach, FL 33141',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'North Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042362/Beachside_All_Suite_nx761l.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 866-7033', $${
   "pools": [],
   "dining": [],
   "in_room": ["Fully equipped kitchens in all suites", "42\" plasma TVs with satellite service"],
   "services": ["Free Wi-Fi throughout the property", "Complimentary beach towels", "Daily towel replenishment and trash pick-up; full housekeeping every third day", "Access to happy hour at Oceanside Hotel (5–6 PM)", "Courtyard with sun loungers and umbrellas", "ATM on-site", "Smoke-free property"]
}$$::jsonb),

/* 21 ─ Oceanside Hotel & Suites ─────────────*/
('Oceanside Hotel & Suites',
 NULL,
 '6084 Collins Avenue, Miami Beach, FL 33140',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'North Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042387/Oceanside_Hotel_srtjbb.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 763-8125', $${
   "pools": ["Outdoor pool with sun loungers"],
   "dining": ["The Tavern (open for breakfast, lunch, dinner, and happy hour)"],
   "in_room": ["42\" plasma TVs with cable channels", "Mini refrigerator and coffee/tea maker in rooms"],
   "services": ["Complimentary beach towels", "Free Wi-Fi throughout the property", "Daily housekeeping service", "24-hour front desk and concierge services", "ATM on-site", "Smoke-free property"]
}$$::jsonb),

/* 22 ─ Seaside All Suites Hotel ─────────────*/
('Seaside All Suites Hotel',
 NULL,
 '7500 Collins Avenue, Miami Beach, FL 33141',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'North Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042405/Seaside_All_Suite_mcvbsl.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 866-7033', $${
   "pools": ["Outdoor swimming pool with sun loungers"],
   "dining": [],
   "in_room": ["Fully equipped kitchens in all suites", "42\" plasma TVs with satellite service", "In-room safe"],
   "services": ["Free Wi-Fi throughout the property", "Complimentary beach towels", "Daily towel replenishment and trash pick-up; full housekeeping every third day", "Complimentary happy hour at Oceanside Hotel (5–6 PM)", "Air conditioning", "Smoke-free property"]
}$$::jsonb),

/* 23 ─ Waterside Hotel & Suites ─────────────*/
('Waterside Hotel & Suites',
 NULL,
 '7310 Harding Avenue, Miami Beach, FL 33141',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'North Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042431/Waterside_Hotel_hw1zod.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 763-8901', $${
   "pools": ["Outdoor swimming pool with sun loungers"],
   "dining": [],
   "in_room": ["Kitchenettes with cookware, dishware, and utensils", "Mini refrigerator and microwave"],
   "services": ["Complimentary beach towels", "Free Wi-Fi throughout the property", "Daily towel replenishment and trash pick-up; full housekeeping every third day", "Complimentary happy hour at Oceanside Hotel (5–6 PM)", "In-room safe", "Air conditioning", "Smoke-free property"]
}$$::jsonb),

/* 24 ─ Hollywood Beach Suites Hotel ─────────*/
('Hollywood Beach Suites Hotel',
 NULL,
 '334 Arizona Street, Hollywood, FL 33019',
 'Hollywood', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'Hollywood Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042431/Waterside_Hotel_hw1zod.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(954) 391-9448', $${
   "pools": [],
   "dining": [],
   "in_room": ["Kitchenettes or full kitchens in most units"],
   "services": ["Steps from Hollywood Beach Boardwalk", "Free Wi-Fi throughout the property", "32\" plasma TVs with cable channels", "Complimentary beach towels", "Bike rentals available", "BBQ grills and picnic area", "Courtyard lounge space", "24-hour front desk", "Smoke-free property"]
}$$::jsonb),

/* 25 ─ Metropole South Beach ────────────────*/
('Metropole South Beach',
 NULL,
 '635 Collins Avenue, Miami Beach, FL 33139',
 'Miami Beach', 'USA', NULL,
 '2025-05-23 19:50:42.299041-03', '2025-05-23 19:50:42.299041-03', NULL,
 'South Beach, Miami Beach, Florida',
 'https://res.cloudinary.com/doqyrz0sg/image/upload/v1748042466/Metropole_South_Beach_bvgxun.jpg',
 0.0, NULL, NULL,
 NULL, NULL, '(305) 672-0009', $${
   "pools": [],
   "dining": [],
   "in_room": ["Fully equipped Italian kitchens", "42\" plasma TVs with satellite channels", "iPod docking stations and stereo systems", "European pillow-top beds with Belgian linens", "Kohler rain showers in marble bathrooms"],
   "services": ["Free Wi-Fi throughout the property", "Complimentary continental breakfast (8–10 AM)", "Free happy hour at Maxine’s Bistro & Bar (5–6 PM)", "Complimentary beach towels", "Daily towel replenishment and trash pick-up; full housekeeping every third day", "Private courtyard with plunge pool and loungers", "24-hour front desk and concierge services", "ATM on-site", "Smoke-free property"]
}$$::jsonb);

///--------------------------------//


/*───────────────────────────────────────────────
  3)  Roles de Staff
───────────────────────────────────────────────*/
INSERT INTO public."StaffRole"
       (name,         default_discount_pct, commission_pct,
        created_at,                updated_at,                deleted_at)
VALUES ('Front Desk', 10, 5,  '2025-05-10 17:50:46.757345-03', '2025-05-10 17:50:46.757345-03', NULL),
       ('Concierge',  15, 7,  '2025-05-10 17:50:46.757345-03', '2025-05-10 17:50:46.757345-03', NULL),
       ('Hotel Manager', 20, 10,'2025-05-10 17:50:46.757345-03','2025-05-10 17:50:46.757345-03', NULL);


       /*──────────────────────────────────────────────
  Rooms – Catalina Hotel & Beach Club (ID 1)
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
/* 101 ─ King Bedroom ─────────────────────────*/
(1, 101, 'King Bedroom',
 'Spacious 28 m² room featuring one king-size bed, city view, marble bathroom and premium linens.',
 'https://res.cloudinary.com/demo/image/upload/catalina_king.jpg',
 350.00,
 2, '1 King',
 ARRAY[
   'Free Wi-Fi', 'Air-conditioning', 'Egyptian cotton sheets',
   'Flat-screen TV', 'Minibar'
 ],
 12,
 '2025-05-28 00:00:00-03', '2025-05-28 00:00:00-03', NULL),

/* 102 ─ Two Double Beds ──────────────────────*/
(1, 102, 'Two Double Beds',
 'Comfortable 30 m² room with two double beds, perfect for families or friends travelling together.',
 'https://res.cloudinary.com/demo/image/upload/catalina_double.jpg',
 370.00,
 4, '2 Double',
 ARRAY[
   'Free Wi-Fi', 'Air-conditioning', 'Premium linens',
   'Flat-screen TV', 'Minibar'
 ],
 8,
 '2025-05-28 00:00:00-03', '2025-05-28 00:00:00-03', NULL),

/* 201 ─ Junior Suite King ────────────────────*/
(1, 201, 'Junior Suite King',
 'Elegant 40 m² junior suite offering a king bed, separate sitting area and pool view.',
 'https://res.cloudinary.com/demo/image/upload/catalina_jr_king.jpg',
 420.00,
 3, '1 King + Sofa Bed',
 ARRAY[
   'Free Wi-Fi', 'Living area', 'Memory-foam mattress',
   'Plasma TV', 'Minibar'
 ],
 6,
 '2025-05-28 00:00:00-03', '2025-05-28 00:00:00-03', NULL),

/* 202 ─ Junior Suite Queen Queen ─────────────*/
(1, 202, 'Junior Suite Queen Queen',
 'Spacious junior suite with two queen beds and a lounge area, accommodating up to four guests.',
 'https://res.cloudinary.com/demo/image/upload/catalina_jr_queen.jpg',
 440.00,
 4, '2 Queen',
 ARRAY[
   'Free Wi-Fi', 'Living area', 'Premium linens',
   'Plasma TV', 'Minibar'
 ],
 6,
 '2025-05-28 00:00:00-03', '2025-05-28 00:00:00-03', NULL);

 /*──────────────────────────────────────────────
  Hotel 2 – Hotel Croydon
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(2, 2001, 'Classic King Room',
 'Elegante habitación con cama king y vista parcial a la ciudad.',
 'https://res.cloudinary.com/demo/image/upload/croydon_king.jpg',
 280.00, 2, '1 King',
 ARRAY['Free Wi-Fi','Minibar','Flat-screen TV'], 10,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(2, 2002, 'Classic Queen Room',
 'Habitación acogedora con una cama queen y escritorio ejecutivo.',
 'https://res.cloudinary.com/demo/image/upload/croydon_queen.jpg',
 260.00, 2, '1 Queen',
 ARRAY['Free Wi-Fi','Minibar','Flat-screen TV'], 12,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(2, 2003, 'Double Queen Room',
 'Espaciosa habitación con dos camas queen ideal para familias.',
 'https://res.cloudinary.com/demo/image/upload/croydon_doublequeen.jpg',
 300.00, 4, '2 Queen',
 ARRAY['Free Wi-Fi','Minibar','Flat-screen TV'], 8,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(2, 2004, 'Penthouse Suite',
 'Suite ático con terraza privada y vistas al océano.',
 'https://res.cloudinary.com/demo/image/upload/croydon_penthouse.jpg',
 550.00, 3, '1 King + Sofa Bed',
 ARRAY['Terrace','Jacuzzi','Free Wi-Fi','Minibar'], 2,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 3 – Riviera Hotel South Beach
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(3, 3001, 'Classic Queen Room',
 'Cómoda habitación queen con detalles art-deco y balcón francés.',
 'https://res.cloudinary.com/demo/image/upload/riviera_classicqueen.jpg',
 270.00, 2, '1 Queen',
 ARRAY['Free Wi-Fi','Rain-shower','Flat-screen TV'], 15,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(3, 3002, 'Superior Double Queen Balcony',
 'Superior room con dos camas queen y amplio balcón vista a la piscina.',
 'https://res.cloudinary.com/demo/image/upload/riviera_superiorbalcony.jpg',
 340.00, 4, '2 Queen',
 ARRAY['Balcony','Free Wi-Fi','Minibar'], 6,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(3, 3003, 'Deluxe One Bedroom Double Queen Suite',
 'Suite de un dormitorio con sala y dos camas queen.',
 'https://res.cloudinary.com/demo/image/upload/riviera_deluxe_doublequeen.jpg',
 430.00, 5, '2 Queen + Sofa Bed',
 ARRAY['Kitchenette','Living area','Rain-shower'], 5,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(3, 3004, 'Lux One Bedroom King Suite',
 'Suite lujosa con dormitorio king y zona lounge estilo vintage.',
 'https://res.cloudinary.com/demo/image/upload/riviera_luxking.jpg',
 450.00, 3, '1 King + Sofa Bed',
 ARRAY['Kitchenette','Living area','Flat-screen TV'], 5,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(3, 3005, 'One Bedroom Queen Queen Suite',
 'Suite con salón independiente y dos camas queen.',
 'https://res.cloudinary.com/demo/image/upload/riviera_queenqueen.jpg',
 420.00, 4, '2 Queen',
 ARRAY['Kitchenette','Free Wi-Fi','Minibar'], 4,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(3, 3006, 'Studio Penthouse with Private Rooftop Garden',
 'Penthouse tipo estudio con jardín privado en la azotea.',
 'https://res.cloudinary.com/demo/image/upload/riviera_rooftop.jpg',
 650.00, 2, '1 King',
 ARRAY['Private rooftop','Garden furniture','Jacuzzi'], 1,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 4 – Tradewinds Apartment Hotel
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(4, 4001, 'Studio Queen',
 'Estudio con cocina completa y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_studioq.jpg',
 220.00, 2, '1 Queen',
 ARRAY['Kitchen','Free Wi-Fi','42" TV'], 12,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4002, 'Accessible Studio Queen',
 'Estudio accesible con baño adaptado y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_accessibleq.jpg',
 220.00, 2, '1 Queen',
 ARRAY['ADA Bathroom','Kitchen','Free Wi-Fi'], 2,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4003, 'One-Bedroom Queen Suite',
 'Suite de un dormitorio con sala independiente y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_1bq.jpg',
 260.00, 3, '1 Queen + Sofa Bed',
 ARRAY['Kitchen','Living area','Free Wi-Fi'], 10,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4004, 'One-Bedroom Double Queen Suite',
 'Suite con dos queens y cocina completa.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_1bqq.jpg',
 280.00, 4, '2 Queen',
 ARRAY['Kitchen','Living area','Free Wi-Fi'], 8,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4005, 'Two-Bedroom Queen Suite',
 'Amplia suite de dos dormitorios, cada uno con cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_2bq.jpg',
 350.00, 5, '2 Queen + Sofa Bed',
 ARRAY['Full kitchen','Dining area','Washer/Dryer'], 4,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4006, 'Courtyard View One-Bedroom Queen Suite',
 'Suite con vistas al patio interior y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_cv1bq.jpg',
 270.00, 3, '1 Queen + Sofa Bed',
 ARRAY['Courtyard view','Kitchen','Free Wi-Fi'], 6,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4007, 'Courtyard View One-Bedroom Double Queen Suite',
 'Suite con vistas al patio y dos camas queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_cv1bqq.jpg',
 290.00, 4, '2 Queen',
 ARRAY['Courtyard view','Kitchen','Free Wi-Fi'], 6,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(4, 4008, 'Pool View One-Bedroom Queen Suite',
 'Suite con vistas a la piscina y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/tradewinds_poolview.jpg',
 295.00, 3, '1 Queen + Sofa Bed',
 ARRAY['Pool view','Kitchen','Free Wi-Fi'], 4,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 5 – Lincoln Arms Suites
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(5, 5001, 'Studio Suite (1 Queen Bed)',
 'Suite tipo estudio con cocina integrada y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/lincoln_studio1q.jpg',
 230.00, 2, '1 Queen',
 ARRAY['Kitchen','Free Wi-Fi','42" TV'], 10,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(5, 5002, 'Studio Suite (2 Queen Beds)',
 'Estudio espacioso con dos camas queen y zona de estar.',
 'https://res.cloudinary.com/demo/image/upload/lincoln_studio2q.jpg',
 260.00, 4, '2 Queen',
 ARRAY['Kitchen','Free Wi-Fi','42" TV'], 8,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(5, 5003, 'One-Bedroom Apartment (1 Queen Bed + Sofa Bed)',
 'Departamento de un dormitorio con sala y sofá cama.',
 'https://res.cloudinary.com/demo/image/upload/lincoln_1b_apartment.jpg',
 310.00, 4, '1 Queen + Sofa Bed',
 ARRAY['Full kitchen','Dining area','Free Wi-Fi'], 6,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 6 – Chesterfield Hotel & Suites
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(6, 6001, 'Standard Room (1 Queen Bed)',
 'Habitación estándar con decoración boutique y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/chesterfield_std1q.jpg',
 210.00, 2, '1 Queen',
 ARRAY['Free Wi-Fi','Minibar','Plasma TV'], 14,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(6, 6002, 'Standard Room (2 Double Beds)',
 'Habitación estándar con dos camas dobles.',
 'https://res.cloudinary.com/demo/image/upload/chesterfield_std2d.jpg',
 230.00, 4, '2 Double',
 ARRAY['Free Wi-Fi','Minibar','Plasma TV'], 12,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(6, 6003, 'Family Studio Suite',
 'Suite familiar con dos camas queen y litera doble individual.',
 'https://res.cloudinary.com/demo/image/upload/chesterfield_family.jpg',
 320.00, 6, '2 Queen + 2 Twin Bunks',
 ARRAY['Kitchenette','Free Wi-Fi','iPod Dock'], 4,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(6, 6004, 'Two-Bedroom Suite',
 'Suite de dos habitaciones, cada una con cama queen.',
 'https://res.cloudinary.com/demo/image/upload/chesterfield_2b.jpg',
 380.00, 5, '2 Queen + Sofa Bed',
 ARRAY['Living area','Free Wi-Fi','Minibar'], 3,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(6, 6005, 'Accessible Room (1 King Bed)',
 'Habitación accesible con cama king y baño adaptado.',
 'https://res.cloudinary.com/demo/image/upload/chesterfield_accessible.jpg',
 230.00, 2, '1 King',
 ARRAY['ADA Bathroom','Free Wi-Fi','Plasma TV'], 2,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 7 – Hotel Shelley
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(7, 7001, 'Standard Room – 1 Queen Bed',
 'Habitación estándar minimalista con cama queen.',
 'https://res.cloudinary.com/demo/image/upload/shelley_1q.jpg',
 190.00, 2, '1 Queen',
 ARRAY['Free Wi-Fi','Mini-fridge','32" TV'], 16,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(7, 7002, 'Standard Room – 2 Double Beds',
 'Habitación estándar con dos camas dobles y piso de mármol.',
 'https://res.cloudinary.com/demo/image/upload/shelley_2d.jpg',
 210.00, 4, '2 Double',
 ARRAY['Free Wi-Fi','Mini-fridge','32" TV'], 14,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


/*──────────────────────────────────────────────
  Hotel 8 – Hotel Chelsea
──────────────────────────────────────────────*/
INSERT INTO public."Room"
      (hotel_id, room_number, name, description, image, price,
       capacity, beds, amenities, available,
       created_at,           updated_at,           deleted_at)
VALUES
(8, 8001, 'Standard Room – 1 Queen Bed',
 'Habitación con estilo art-deco y cama queen.',
 'https://res.cloudinary.com/demo/image/upload/chelsea_1q.jpg',
 200.00, 2, '1 Queen',
 ARRAY['Free Wi-Fi','Mini-fridge','42" TV'], 12,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL),

(8, 8002, 'Standard Room – 2 Double Beds',
 'Habitación amplia con dos camas dobles y escritorio ejecutivo.',
 'https://res.cloudinary.com/demo/image/upload/chelsea_2d.jpg',
 220.00, 4, '2 Double',
 ARRAY['Free Wi-Fi','Mini-fridge','42" TV'], 10,
 '2025-05-28 00:00:00-03','2025-05-28 00:00:00-03', NULL);


 //-------------------//

 // ADDONS //

INSERT INTO "AddOn" (name, description, price, created_at, updated_at) VALUES
-- 1
('Incidentals Coverage',
 'Protection against minor-accident charges (towel stains, key loss, etc.)',
 10.00, NOW(), NOW()),
-- 2
('Late Check-Out',
 'Extend your departure time.',
 45.60, NOW(), NOW()),
-- 3
('Early Check-In',
 'Room ready by 1 PM instead of 4 PM.',
 68.40, NOW(), NOW()),
-- 4
('Room Upgrade',
 'Larger room or better view for the rest of the stay.',
 102.60, NOW(), NOW()),
-- 5
('Breakfast',
 'Daily breakfast for two guests at Maxine’s (8 AM – 10 AM).',
 22.80, NOW(), NOW()),
-- 6
('Welcome Basket',
 'In-room champagne and assorted snacks on arrival.',
 36.00, NOW(), NOW()),
-- 7
('Valet Parking',
 'Valet service until 1 PM next day.',
 50.00, NOW(), NOW()),
-- 8
('Airport / Cruise-Port Taxi',
 'One-way private ride to MIA Airport or Port of Miami.',
 75.00, NOW(), NOW()),
-- 9
('Laundry Service',
 'Normal wash & fold or dry-clean items charged per piece.',
 0.00, NOW(), NOW()),        -- precio base 0: depende de la opción
-- 10
('Beach Equipment Rental',
 'Chairs / umbrella delivered and set up on the beach.',
 25.00, NOW(), NOW()),       -- precio base = opción más barata
-- 11
('Miami Tours',
 'Partnered city and day tours in and around Miami.',
 40.00, NOW(), NOW());       -- precio base = opción más barata

 ///---aDDONS OPTIONS----//

 /* -- Beach Equipment Rental --------------------------------------- */
WITH beach AS (
  SELECT id FROM add_on WHERE name = 'Beach Equipment Rental'
)
INSERT INTO add_on_option (add_on_id, name, price) VALUES
((SELECT id FROM beach), '1 Chair',                                  25.00),
((SELECT id FROM beach), '1 Umbrella',                               30.00),
((SELECT id FROM beach), '2 Chairs + 1 Umbrella (Bundle)',           65.00);

/* -- Miami Tours --------------------------------------------------- */
WITH tours AS (
  SELECT id FROM add_on WHERE name = 'Miami Tours'
)
INSERT INTO add_on_option (add_on_id, name, price) VALUES
((SELECT id FROM tours), 'City Tour',                                40.00),
((SELECT id FROM tours), 'City + Boat Combo',                        65.00),
((SELECT id FROM tours), 'Everglades Safari',                        65.00),
((SELECT id FROM tours), 'Key West Day Trip',                        70.00),
((SELECT id FROM tours), 'Bahamas Day Tour',                        310.00);

/* -- Laundry Service ---------------------------------------------- */
WITH laundry AS (
  SELECT id FROM add_on WHERE name = 'Laundry Service'
)
INSERT INTO add_on_option (add_on_id, name, price) VALUES
((SELECT id FROM laundry), 'Normal Wash + Fold',                      5.00),
((SELECT id FROM laundry), 'Dry Cleaning',                           10.00);