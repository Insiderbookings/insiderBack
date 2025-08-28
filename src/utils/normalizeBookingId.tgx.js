// src/utils/tgx.js
export const normalizeTGXBookingID = (id) => {
  let s = String(id || "").trim()
  // si viene algo antes de "<digito>@" (p.ej. 'n1@'), lo cortamos desde ahí
  const i = s.search(/\d@/)
  if (i > 0) s = s.slice(i)
  // algunos sellers agregan un '[' al final
  s = s.replace(/\[$/, "")
  return s
}
