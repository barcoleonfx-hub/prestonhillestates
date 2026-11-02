'use client'
import { useFormStatus } from 'react-dom'

export function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      className="btn btn-danger"
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm('Delete this property and all its photos, videos and documents? This can’t be undone.')) e.preventDefault()
      }}
    >
      {pending ? 'Deleting…' : 'Delete property'}
    </button>
  )
}
