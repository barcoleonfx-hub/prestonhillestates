'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { keepDone } from '../(home)/valuation/ValuationDone'

/**
 * The homepage's valuation form is sent by the design kit (system.js posts it and shows its status line). Once the
 * branch has it, this takes the visitor to the thank-you page (the page Google Ads counts) with what they asked.
 */
export function ValuationHandoff() {
  const router = useRouter()
  useEffect(() => {
    const form = document.getElementById('valuation-form') as HTMLFormElement | null
    const status = form?.querySelector('[data-form-status]')
    if (!form || !status) return
    let asked: { name: string; postcode: string; intent: string } | null = null
    const onSubmit = () => {
      const f = new FormData(form)
      asked = { name: String(f.get('name') ?? ''), postcode: String(f.get('postcode') ?? '').toUpperCase().trim(), intent: String(f.get('intent') ?? 'selling') }
    }
    form.addEventListener('submit', onSubmit, { capture: true })
    const sent = form.dataset.sent ?? ''
    const watch = new MutationObserver(() => {
      if (!asked || status.textContent !== sent) return
      const intent = asked.intent === 'letting' ? 'letting' : 'selling'
      keepDone({ first: asked.name.split(/\s+/)[0] ?? '', address: '', postcode: asked.postcode, time: '', intent, estimate: null, ask: { postcode: asked.postcode, intent, propertyType: '', bedrooms: '', address: '' } })
      router.push('/valuation/thank-you')
    })
    watch.observe(status, { childList: true, characterData: true, subtree: true })
    return () => { form.removeEventListener('submit', onSubmit, { capture: true }); watch.disconnect() }
  }, [router])
  return null
}
