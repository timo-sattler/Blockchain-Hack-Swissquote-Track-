/** The real wallet app (same origin, served at "/") inside a phone frame, so the audience sees the app next to the network. */
export function AppPhone({ src = '/' }: { src?: string }) {
  return (
    <div className="app-phone-col">
      <div className="app-phone">
        <div className="app-phone-notch" />
        <div className="app-phone-screen">
          <iframe
            src={src}
            title="Swissquote app with the self-custody wallet"
            allow="publickey-credentials-get *; publickey-credentials-create *; clipboard-write"
          />
        </div>
      </div>
    </div>
  )
}
