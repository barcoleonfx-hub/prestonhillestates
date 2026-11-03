// Real client reviews only. Add each one with the reviewer's name as shown on Google (or initials),
// the date and the star rating, copied exactly. Never edit the wording or add reviews that weren't written.

export type Review = { name: string; date?: string; rating?: number; text: string; source: string }

export const REVIEWS: Review[] = [
  {
    name: 'Client review',
    text: 'I’ve worked with several agents in the past, but none as knowledgeable and helpful as the team at Preston Hill Estates. Buying, selling or renting, they are the best in the business.',
    source: 'From our previous website',
  },
]
