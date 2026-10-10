import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useLiveFeed } from './live'
import { SLIDES } from './slides'
import './present.css'

const STAGE = { width: 1600, height: 900 }

function slideFromHash() {
  const index = SLIDES.findIndex((s) => `#${s.id}` === window.location.hash)
  return index >= 0 ? index : 0
}

function Deck() {
  const [index, setIndex] = useState(slideFromHash)
  const [scale, setScale] = useState(1)
  const live = useLiveFeed()

  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(SLIDES.length - 1, next))), [])

  useEffect(() => {
    window.history.replaceState(null, '', `#${SLIDES[index].id}`)
  }, [index])

  // Fit the 16:9 stage into any window or projector.
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Arrow keys, space and presenter clickers (which send PageUp / PageDown).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) go(index + 1)
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(event.key)) go(index - 1)
      else if (event.key === 'Home') go(0)
      else if (event.key === 'End') go(SLIDES.length - 1)
      else if (event.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
      else if (event.key === 's') live.simulate()
      else if (event.key === 'c') live.clear()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go, live])

  const slide = SLIDES[index]

  return (
    <div className="viewport">
      <div className="stage" style={{ width: STAGE.width, height: STAGE.height, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <section key={slide.id} className={`slide slide-${slide.id}`}>
          {slide.render(live)}
        </section>

        <footer className="deck-bar">
          <span className={`live-pill ${live.status}`}>
            <i />
            {live.status === 'connected' ? 'Share service live' : live.status === 'offline' ? 'Share service offline' : 'Share service not configured'}
          </span>
          {live.simulating && <span className="sim-pill">SIMULATED EVENTS</span>}
          <div className="progress">
            {SLIDES.map((s, i) => (
              <button key={s.id} className={i === index ? 'active' : i < index ? 'past' : ''} onClick={() => go(i)} title={s.title} aria-label={s.title} />
            ))}
          </div>
          <span className="count">
            {index + 1} / {SLIDES.length}
          </span>
        </footer>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Deck />
  </StrictMode>,
)
