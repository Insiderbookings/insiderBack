import { WebbedsProvider } from "../providers/webbeds/provider.js"

const provider = new WebbedsProvider()

export const search = (req, res, next) => provider.search(req, res, next)
