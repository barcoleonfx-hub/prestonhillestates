import { migrate } from '../src/db/client'

migrate().then((applied) => {
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.')
})
