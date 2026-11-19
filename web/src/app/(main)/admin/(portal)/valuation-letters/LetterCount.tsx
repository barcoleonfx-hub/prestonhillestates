'use client'

/** "Print letters for 12 people": counts the ticked boxes. */
export function LetterCount() {
  return (
    <button className="btn btn-gold" type="submit" ref={(el) => {
      if (!el) return
      const update = () => {
        const n = document.querySelectorAll<HTMLInputElement>('input[name="id"]:checked').length
        el.textContent = n ? `Print letters for ${n} ${n === 1 ? 'person' : 'people'}` : 'Tick the people to write to'
        el.disabled = !n
      }
      update()
      document.addEventListener('change', update)
      document.addEventListener('rc-count', update)
    }}>Tick the people to write to</button>
  )
}
