// src/scripts/generate_tgx_cert.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GraphQLClient } from "graphql-request";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TGX_ENDPOINT = process.env.TGX_ENDPOINT || "https://api.travelgate.com";
const TGX_KEY      = process.env.TGX_KEY;
const TGX_CLIENT   = process.env.TGX_CLIENT || "insiderbookings";
const TGX_CONTEXT  = process.env.TGX_CONTEXT || "HOTELTEST";
const CERT_DIR     = process.env.CERT_DIR || "cert";

if (!TGX_KEY) {
  console.error("🛑 Falta TGX_KEY en .env");
  process.exit(1);
}

const client = new GraphQLClient(TGX_ENDPOINT, {
  headers: {
    Authorization: `ApiKey ${TGX_KEY}`, // usa 'ApiKey' (K mayúscula)
    "User-Agent": "InsiderBookings/1.0",
    "Content-Type": "application/json",
  },
});

/* ─────────── helpers ─────────── */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function writeJSON(name, obj) {
  const out = path.join(CERT_DIR, name);
  fs.writeFileSync(out, JSON.stringify(obj, null, 2), "utf8");
  console.log("✅", name);
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ─────────── settings ─────────── */
const SETTINGS = {
  client: TGX_CLIENT,
  context: TGX_CONTEXT,
  timeout: 25000,
  testMode: true,
  // OJO: no incluimos auditData en selection set para evitar errores de schema.
  // Logueo de Travelgate es interno para certificación.
};

/* ─────────── queries (como STRINGS, no AST) ─────────── */

// Content: hotels (solo RS es requerido)
const HOTELS_Q = `
  query ($criteriaHotels: HotelXHotelListInput!, $token: String) {
    hotelX {
      hotels(criteria: $criteriaHotels, token: $token) {
        token
        count
        edges {
          node {
            hotelData {
              hotelCode
              hotelName
            }
          }
        }
      }
    }
  }
`;

// Search (nota: arg se llama filterSearch)
const SEARCH_Q = `
  query (
    $criteria: HotelCriteriaSearchInput!
    $settings: HotelSettingsInput!
    $filter: HotelXFilterSearchInput
  ) {
    hotelX {
      search(
        criteria: $criteria
        settings: $settings
        filterSearch: $filter
      ) {
        options {
          id
          hotelCode
          hotelName
          price { currency net gross binding }
          cancelPolicy {
            refundable
            cancelPenalties { deadline penaltyType currency value }
          }
          rooms {
            occupancyRefId
            refundable
          }
        }
        errors { code type description }
        warnings { code type description }
      }
    }
  }
`;

// Quote
const QUOTE_Q = `
  query ($criteriaQuote: HotelCriteriaQuoteInput!, $settings: HotelSettingsInput) {
    hotelX {
      quote(criteria: $criteriaQuote, settings: $settings) {
        optionQuote {
          optionRefId
          status
          price { currency net gross binding }
          cancelPolicy {
            refundable
            cancelPenalties { deadline penaltyType currency value }
          }
        }
        errors { code type description }
        warnings { code type description }
      }
    }
  }
`;

// Book
const BOOK_MUT = `
  mutation ($input: HotelBookInput!, $settings: HotelSettingsInput!) {
    hotelX {
      book(input: $input, settings: $settings) {
        booking {
          status
          reference { bookingID client supplier hotel }
          price { currency net }
          holder { name surname }
        }
        errors { code type description }
        warnings { code type description }
      }
    }
  }
`;

// Cancel
const CANCEL_MUT = `
  mutation ($input: HotelCancelInput!, $settings: HotelSettingsInput!) {
    hotelX {
      cancel(input: $input, settings: $settings) {
        errors { code type description }
        warnings { code type description }
      }
    }
  }
`;

/* ─────────── main ─────────── */
async function main() {
  ensureDir(CERT_DIR);

  // Fechas CLI o mañana +1
  const start = process.argv[2] ? new Date(process.argv[2]) : addDays(new Date(), 1);
  const end   = process.argv[3] ? new Date(process.argv[3]) : addDays(start, 1);

  console.log("🧩 Generando certificados con fechas:", ymd(start), "→", ymd(end));

  /* 1) Content (RS) — hoteles 1,2,23 en access "2" (TGX test) */
  const hotelsVars = {
    criteriaHotels: {
      access: "2",
      hotelCodes: ["1","2","23"]
    },
    token: null
  };
  const hotelsRS = await client.request(HOTELS_Q, hotelsVars).catch(e => e.response ?? e);
  writeJSON("rs_hotels.json", hotelsRS);

  /* 2) SEARCH (C1 refundable) — reintento +7 días */
  const baseCriteria = {
    checkIn  : ymd(start),
    checkOut : ymd(end),
    occupancies: [{ paxes: [{ age: 30 }] }],
    currency : "EUR",
    markets  : ["ES"],
    language : "es",
    nationality: "ES",
    hotels   : ["1","2","23"],
  };
  const filter = { access: { includes: ["2"] } };

  let optionRefId = null;
  let usedCriteria = baseCriteria;

  for (let i = 0; i < 7; i++) {
    const crit = i === 0
      ? baseCriteria
      : { ...baseCriteria, checkIn: ymd(addDays(start, i)), checkOut: ymd(addDays(end, i)) };

    const vars = { criteria: crit, settings: SETTINGS, filter };
    const rs = await client.request(SEARCH_Q, vars).catch(e => e.response ?? e);

    // Guardar el primer intento como RQ/RS oficiales
    if (i === 0) {
      writeJSON("rq_search_rf.json", { query: SEARCH_Q, variables: vars });
      writeJSON("rs_search_rf.json", rs);
    }

    const options = rs?.hotelX?.search?.options || [];
    const firstRefundable =
      options.find(o => o?.cancelPolicy?.refundable) ||
      options.find(o => o?.rooms?.some(r => r?.refundable));

    if (firstRefundable) {
      optionRefId = firstRefundable.id; // en tu schema el id de search va a quote.optionRefId
      usedCriteria = crit;
      break;
    }
  }
  if (!optionRefId) throw new Error("Search no devolvió opciones");

  /* 3) QUOTE */
  const quoteVars = {
    criteriaQuote: { optionRefId },
    settings: SETTINGS,
  };
  const quoteRS = await client.request(QUOTE_Q, quoteVars).catch(e => e.response ?? e);
  writeJSON("rq_quote_rf.json", { query: QUOTE_Q, variables: quoteVars });
  writeJSON("rs_quote_rf.json", quoteRS);

  /* 4) BOOK */
  // Tomamos occupancyRefId = 1 por simplicidad (o podrías leerlo del search si lo necesitás)
  const bookVars = {
    input: {
      optionRefId,
      clientReference: `CERT-${Date.now()}`,
      holder: { name: "Test", surname: "Buyer" },
      rooms: [{ occupancyRefId: 1, paxes: [{ name: "Test", surname: "Buyer", age: 30 }] }],
      remarks: "Certification run",
    },
    settings: SETTINGS,
  };
  const bookRS = await client.request(BOOK_MUT, bookVars).catch(e => e.response ?? e);
  writeJSON("rq_book_rf.json", { query: BOOK_MUT, variables: bookVars });
  writeJSON("rs_book_rf.json", bookRS);

  const bookingID =
    bookRS?.hotelX?.book?.booking?.reference?.bookingID ||
    bookRS?.hotelX?.book?.booking?.reference ||
    null;

  if (!bookingID) {
    console.warn("⚠️ No bookingID en rs_book_rf.json — no se puede cancelar.");
    return;
  }

  /* 5) CANCEL */
  const cancelVars = { input: { bookingID }, settings: SETTINGS };
  const cancelRS = await client.request(CANCEL_MUT, cancelVars).catch(e => e.response ?? e);
  writeJSON("rq_cancel_rf.json", { query: CANCEL_MUT, variables: cancelVars });
  writeJSON("rs_cancel_rf.json", cancelRS);

  // extra debug de fechas usadas
  writeJSON("_debug_used_criteria.json", { usedCriteria });
}

main().catch((err) => {
  console.error("❌ Error general:", err?.message || err);
  if (err?.response) {
    console.error(JSON.stringify(err.response, null, 2));
  }
  process.exit(1);
});
