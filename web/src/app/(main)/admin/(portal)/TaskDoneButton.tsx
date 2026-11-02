import { completeTask } from '../crm-actions'

export function TaskDoneButton({ id }: { id: string }) {
  return (
    <form action={completeTask}>
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-ghost btn-sm" type="submit" title="Mark as done without logging a call">Done</button>
    </form>
  )
}
