import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "")
const useLegacy = params.has("legacy")

const root = createRoot(document.getElementById("root")!)

if (useLegacy) {
  // Lazy-load legacy dashboard so it doesn't impact workstation bundle
  import("./App").then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
} else {
  import("./workstation/Workstation").then(({ Workstation }) => {
    root.render(
      <StrictMode>
        <Workstation />
      </StrictMode>
    )
  })
}
