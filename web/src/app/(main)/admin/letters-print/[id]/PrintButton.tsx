'use client'

export function PrintButton() {
  return <button type="button" className="pl-btn" onClick={() => window.print()}>Print the letters</button>
}
