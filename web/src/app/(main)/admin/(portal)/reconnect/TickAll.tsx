'use client'

/** Ticks or unticks every box in one list, and keeps the "Send to N" count up to date. */
export function TickAll({ group }: { group: string }) {
  return (
    <label className="rc-tickall">
      <input type="checkbox" onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[data-group="${group}"]:not(:disabled)`).forEach((b) => { b.checked = e.target.checked })
        document.dispatchEvent(new Event('rc-count'))
      }} /> Tick all
    </label>
  )
}

/** "Send to 3 people": counts the ticked boxes. */
export function SendButton() {
  return (
    <button className="btn btn-gold" type="submit" ref={(el) => {
      if (!el) return
      const update = () => {
        const n = document.querySelectorAll<HTMLInputElement>('input[name="id"]:checked').length
        el.textContent = n ? `Send a reconnect email to ${n} ${n === 1 ? 'person' : 'people'}` : 'Tick the people to reconnect with'
        el.disabled = !n
      }
      update()
      document.addEventListener('change', update)
      document.addEventListener('rc-count', update)
    }}>Tick the people to reconnect with</button>
  )
}
