import { redirect } from 'next/navigation'

// The designed homepage is ported here next; until then the property search is the landing page.
export default function Home() {
  redirect('/properties')
}
