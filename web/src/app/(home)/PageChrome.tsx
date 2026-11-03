import Script from 'next/script'
import { FOOTER, HEADER, SPRITE } from './home-content'

const CHROME_JS = `(function(){
  var h=document.getElementById('siteHeader'); if(h){var f=function(){h.classList.toggle('scrolled',window.scrollY>30)};addEventListener('scroll',f,{passive:true});f();}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:0.12});
  document.querySelectorAll('.rv').forEach(function(el){io.observe(el)});
  var c=document.getElementById('copyright'); if(c) c.textContent='© '+new Date().getFullYear()+' Preston Hill Estates · Company No. 05058532';
  var top=document.getElementById('toTop'); if(top){var t=function(){top.classList.toggle('show',window.scrollY>900)};addEventListener('scroll',t,{passive:true});t();
    top.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'})});}
})();`

/** Header, footer and scroll effects shared by pages built in the homepage design. */
export function PageChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: SPRITE + HEADER }} />
      {children}
      <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: FOOTER }} />
      <button type="button" id="toTop" className="to-top" aria-label="Back to top">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <Script id="page-chrome" strategy="afterInteractive">{CHROME_JS}</Script>
    </>
  )
}
