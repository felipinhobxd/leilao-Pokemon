'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [{ href: '/', label: 'Painel' }, { href: '/auctions/new', label: 'Criar leilão' }, { href: '/auctions/brinde', label: 'Brindes e Quiz' }, { href: '/whatsapp', label: 'WhatsApp' }];
type Theme = 'system' | 'light' | 'dark';
export default function SiteNavigation() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('leilao-theme-v1');
      if (saved === 'light' || saved === 'dark') { setTheme(saved); document.documentElement.dataset.theme = saved; }
    } catch { /* Preferences are optional in private browsing. */ }
  }, []);
  function changeTheme(value: Theme) {
    setTheme(value);
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try { localStorage.setItem('leilao-theme-v1', value); } catch {}
  }
  return <>
    <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
    <div className="site-bar"><div className="site-bar-inner">
      <Link className="brand" href="/" aria-label="Leilão Pokémon — painel"><span className="brand-mark" aria-hidden="true">L</span><span>Leilão<span className="brand-subtitle">POKÉMON</span></span></Link>
      <nav className="site-links" aria-label="Navegação principal">{links.map(link => <Link key={link.href} href={link.href} aria-current={(link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)) ? 'page' : undefined}>{link.label}</Link>)}</nav>
      <label className="theme-control"><span className="sr-only">Aparência</span><select aria-label="Aparência" value={theme} onChange={event => changeTheme(event.target.value as Theme)}><option value="system">Tema do sistema</option><option value="light">Tema claro</option><option value="dark">Tema escuro</option></select></label>
    </div></div>
  </>;
}
