import { useEffect, useRef, useState } from "react"

/**
 * Phase BNDS-1A (BNDS-1A-7): Screenshot Intake — FOUNDATION ONLY
 *
 * STRICT operator constraints:
 *   • NO OCR
 *   • NO fake OCR
 *   • NO fake AI parsing
 *   • NO fabricated intelligence
 *
 * What this component DOES:
 *   • Accepts cmd+v paste of an image from the clipboard
 *   • Accepts drag-and-drop of image files onto its surface
 *   • Stages received images in a tray (in-memory, session-only)
 *   • Reports honestly: "Screenshot received — parsing pipeline not connected yet."
 *
 * What this component DOES NOT DO:
 *   • Does not OCR or parse images.
 *   • Does not invoke any vision model.
 *   • Does not call any backend endpoint.
 *   • Does not pretend the image was understood.
 *   • Does not persist images across sessions.
 *
 * Anti-fabrication doctrine: the 📸 affordance promises ONLY the staging
 * behavior that exists today. When the OCR pipeline is eventually built
 * (operator-deferred), this component's API stays stable and the honest
 * "not connected yet" copy is replaced with the real parsed-leg surface.
 */
export function ScreenshotIntake() {
  const [stagedImages, setStagedImages] = useState<Array<{ id: string; dataUrl: string; receivedAt: string }>>([])
  const [hover, setHover]               = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // ── Clipboard cmd+v handler ───────────────────────────────────────────────
  useEffect(() => {
    function onPaste(ev: ClipboardEvent) {
      const items = ev.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile()
          if (file) {
            void stageFile(file)
            ev.preventDefault()
            return
          }
        }
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  async function stageFile(file: File): Promise<void> {
    const dataUrl = await fileToDataUrl(file)
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setStagedImages((prev) => [
      ...prev,
      { id, dataUrl, receivedAt: new Date().toLocaleTimeString() },
    ])
  }

  function onDrop(ev: React.DragEvent) {
    ev.preventDefault()
    setHover(false)
    const files = Array.from(ev.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"))
    for (const f of files) void stageFile(f)
  }

  function onDragOver(ev: React.DragEvent) {
    ev.preventDefault()
    if (!hover) setHover(true)
  }
  function onDragLeave() {
    setHover(false)
  }

  function onPickFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || []).filter((f) => f.type.startsWith("image/"))
    for (const f of files) void stageFile(f)
    if (ev.target) ev.target.value = ""   // allow re-pick same file
  }

  function removeImage(id: string) {
    setStagedImages((prev) => prev.filter((x) => x.id !== id))
  }

  return (
    <div className="ws-card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        📸 Drop or paste a slip screenshot
      </div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        style={{
          border:    hover ? "2px dashed var(--ws-positive)" : "2px dashed var(--ws-border, #555)",
          borderRadius: 6,
          padding: 18,
          textAlign: "center",
          cursor: "pointer",
          background: hover ? "var(--ws-card-hover-bg, rgba(34,197,94,0.05))" : "transparent",
          transition: "background 120ms ease",
        }}
      >
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          Drop an image here, click to pick a file, or press <kbd style={{ padding: "1px 6px", border: "1px solid var(--ws-border, #444)", borderRadius: 3, fontFamily: "var(--ws-mono)" }}>⌘V</kbd>
        </div>
        <div className="ws-dim" style={{ fontSize: 11, fontStyle: "italic" }}>
          Screenshots are staged in-memory only — the parsing pipeline is not connected yet.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPickFile}
          style={{ display: "none" }}
        />
      </div>

      {stagedImages.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="ws-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            Staging tray ({stagedImages.length}) — session-only
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {stagedImages.map((img) => (
              <div
                key={img.id}
                style={{
                  border: "1px solid var(--ws-border, #444)",
                  borderRadius: 4,
                  padding: 6,
                  width: 140,
                  fontSize: 11,
                }}
              >
                <img
                  src={img.dataUrl}
                  alt={`staged ${img.id}`}
                  style={{ width: "100%", maxHeight: 80, objectFit: "cover", borderRadius: 3, display: "block" }}
                />
                <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="ws-dim" style={{ fontSize: 10 }}>{img.receivedAt}</span>
                  <button
                    className="ws-btn ws-btn-icon"
                    onClick={() => removeImage(img.id)}
                    title="Remove from staging tray"
                    style={{ fontSize: 11 }}
                  >×</button>
                </div>
              </div>
            ))}
          </div>
          <div className="ws-dim" style={{ fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
            Screenshot received — parsing pipeline not connected yet. Use the Borrow or Paste path in Check My Slip for canonical analysis today.
          </div>
        </div>
      )}
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(String(r.result || ""))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
