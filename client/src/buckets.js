// The card buckets Buypal produces. Colours are used only as a small marker next to the name.
export const BUCKETS = {
  Smart: { label: 'Best overall', color: '#1d63e8', blurb: 'The strongest mix of quality and price.' },
  Premium: { label: 'Best quality', color: '#0a1f4d', blurb: 'The strongest specs and ratings that fit your budget.' },
  Budget: { label: 'Best price', color: '#0e8f6a', blurb: 'The lowest price that meets every requirement.' },
  Loved: { label: 'Most loved', color: '#b4235a', blurb: 'The highest rating you can trust, with 50+ reviews.' },
  Deal: { label: 'Best deal', color: '#b45309', blurb: 'The biggest verified markdown on a well-rated product.' },
  Personal: { label: 'Picked for you', color: '#0e7490', blurb: 'The best option from a brand you have shown you like.' },
};

const FALLBACK = { label: '', color: '#5b6785' };
export const bucketOf = (card) => BUCKETS[(card.strategies?.[0] || '').replace(' alt', '')] || FALLBACK;
