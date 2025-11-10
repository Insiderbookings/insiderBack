import { bookTGX } from "./services/booking.service.js"

export const book = async (req, res, next) => {
  try {
    const {
      optionRefId,
      holder,
      rooms,
      clientReference,
      remarks,
      paymentReference,
      guestEmail,
    } = req.body

    if (!optionRefId || !holder || !rooms?.length) {
      return res.status(400).json({ error: "Missing booking data" })
    }

    const cleanHolder = { name: holder.name, surname: holder.surname }

    let finalRemarks = remarks || ""
    const emailToAttach = holder.email || guestEmail
    if (emailToAttach) {
      finalRemarks = finalRemarks
        ? `${finalRemarks}\nGuest email: ${emailToAttach}`
        : `Guest email: ${emailToAttach}`
    }

    const input = {
      optionRefId,
      clientReference: clientReference || `BK-${Date.now()}`,
      holder: cleanHolder,
      rooms,
      ...(finalRemarks && { remarks: finalRemarks }),
      ...(paymentReference && { paymentReference }),
    }

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 30000,
      testMode: true,
    }

    const data = await bookTGX(input, settings)
    res.json(data)
  } catch (err) {
    next(err)
  }
}



