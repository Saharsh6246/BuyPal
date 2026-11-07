import { IconBag, IconUser } from './icons.jsx';
import Logo from './Logo.jsx';

export default function Header({ ai, cartCount, showHome, onHome, onProfile, onCart }) {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button type="button" onClick={onHome} aria-label="Buypal, back to start" className="rounded-lg outline-offset-4"><Logo /></button>
        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="Main">
          {ai && (
            <span className="mr-1 hidden items-center gap-2 text-xs font-medium text-muted md:inline-flex" title="Buypal stops calling the AI model at the daily limit, so it can never bill you.">
              <span className={`h-2 w-2 rounded-full ${ai.enabled ? 'bg-mint' : 'bg-rule-strong'}`} />
              {ai.enabled ? `AI assistant on · ${ai.calls}/${ai.limit} calls today` : 'Basic mode (no AI key)'}
            </span>
          )}
          {!showHome && <button type="button" onClick={onHome} className="btn btn-outline hidden !px-3.5 !py-2 sm:inline-flex">New search</button>}
          <button type="button" onClick={onProfile} className="btn btn-outline !px-3 !py-2" aria-label="Your shopping profile"><IconUser size={18} /><span className="hidden sm:inline">Profile</span></button>
          <button type="button" onClick={onCart} className="btn btn-dark relative !px-3.5 !py-2" aria-label={`Cart, ${cartCount} items`}>
            <IconBag size={18} /><span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && <span className="ml-0.5 rounded-full bg-azure px-1.5 text-[11px] font-bold leading-5 text-white">{cartCount}</span>}
          </button>
        </nav>
      </div>
    </header>
  );
}
