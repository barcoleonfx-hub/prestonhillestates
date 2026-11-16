import type { Metadata } from 'next'
import { CONSENT_WORDING } from '@/lib/lead-rules'
import { PageChrome } from '../PageChrome'
import '../valuation/valuation.css'
import '../fees/fees.css'
import './privacy.css'

export const metadata: Metadata = {
  title: 'Privacy policy · Preston Hill Estates',
  description: 'What personal information Preston Hill Estates keeps when you contact us, why, for how long, and your rights.',
}

const UPDATED = '16 November 2026'

/** The privacy notice (UK GDPR articles 13 and 14), in plain English. Keep it true to what the site and portal do. */
export default function PrivacyPage() {
  return (
    <PageChrome reviews={false}>
      <main className="vx fx pv" id="top">
        <section className="fx-hero">
          <div className="wide">
            <div className="label"><b>Privacy</b></div>
            <h1 className="display">Your information, <em>looked after</em></h1>
            <p className="sub">What we keep when you contact us, why we keep it, who sees it, how long we hold it and what you can ask us to do. Last updated {UPDATED}.</p>
          </div>
        </section>

        <section className="wide fx-sect pv-body">
          <h2 className="sect">Who we are</h2>
          <p>Preston Hill Estates (company number 05058532), 271 Preston Road, Harrow HA3 0PS, is responsible for your information. For anything about your data, email <a href="mailto:info@prestonhillestates.com">info@prestonhillestates.com</a>, call <a href="tel:+442089049005">020 8904 9005</a>, or write to us at the branch.</p>

          <h2 className="sect">What we keep</h2>
          <ul>
            <li><b>What you tell us:</b> your name, phone number, email address, the property you’re asking about or want valued, and anything you write in a message or tell us on the phone.</li>
            <li><b>What we do together:</b> emails between us, notes of calls, viewings and valuations booked, and what happened.</li>
            <li><b>How you found us:</b> when you send a form on our website, the page you first arrived on, the website that sent you, and the advert or campaign link you clicked if there was one. This helps us see which of our adverts work.</li>
            <li><b>What you agreed to:</b> if you tick a box to hear from us, the exact wording, the date and which form.</li>
          </ul>
          <p>We also receive enquiries you send us through Zoopla and OnTheMarket, which arrive by email.</p>

          <h2 className="sect">Why we use it</h2>
          <ul>
            <li><b>To deal with your enquiry</b>, such as arranging a viewing or valuation, and following it up. This is needed to do what you asked, before any agreement (UK GDPR article 6(1)(b)), and it’s in our legitimate interest to follow up an enquiry you made (article 6(1)(f)).</li>
            <li><b>To tell you about other homes, local prices and news</b>, by email or WhatsApp, only if you ticked the box to agree (article 6(1)(a)). You can stop this at any time: use the unsubscribe link in any email, reply STOP on WhatsApp, or ask us.</li>
            <li><b>Where the law requires it</b>, for example identity and anti-money-laundering checks on sales, and Right to Rent checks on lettings (article 6(1)(c)).</li>
          </ul>
          <p>The boxes on our forms are never ticked for you, and leaving them unticked doesn’t change how we handle your enquiry. The words next to them are:</p>
          <blockquote>“{CONSENT_WORDING.email}”</blockquote>
          <blockquote>“{CONSENT_WORDING.whatsapp}”</blockquote>

          <h2 className="sect">Who sees it</h2>
          <p>Our staff at the branch. Where it’s needed for your enquiry, we share relevant details with the seller or landlord of a property you’re interested in, and with solicitors or referencing agencies in a sale or tenancy. The companies that run our systems store it for us: our website and staff system are hosted by Render, and our email is held by our email provider. We don’t sell your information, and we don’t share it with anyone for their own marketing.</p>

          <h2 className="sect">How long we keep it</h2>
          <p>Our system deletes things automatically: each enquiry 2 years after it was made, and your record (with the calls, emails, notes and consent that go with it) 2 years after we were last in touch, unless something is still booked or to do. You can ask us to delete your information sooner. Where the law says we must keep records for longer (for example anti-money-laundering records, kept for 5 years after a sale ends), we keep those for that time.</p>

          <h2 className="sect">What our website stores in your browser</h2>
          <p>We don’t use advertising or tracking cookies. Our website keeps a few small notes in your own browser (local storage), which never leave it until you send a form:</p>
          <ul>
            <li>how you first arrived (the page, the site that sent you, and any advert link), for 90 days, sent with any form you fill in;</li>
            <li>that you closed or sent the valuation pop-up or the chat, so we don’t keep showing them.</li>
          </ul>
          <p>We also count how often the WhatsApp buttons are tapped, and on which page, without keeping anything about who tapped them. Videos on property pages play from YouTube’s privacy-enhanced (no-cookie) service. You can clear these notes at any time in your browser settings.</p>

          <h2 className="sect">Your rights</h2>
          <p>You can ask us, free of charge, to:</p>
          <ul>
            <li>give you a copy of the information we hold about you;</li>
            <li>correct anything that’s wrong;</li>
            <li>delete your information (unless the law says we must keep it);</li>
            <li>stop or limit how we use it, or object to us using it, including for marketing at any time;</li>
            <li>give you your information in a format you can take elsewhere.</li>
          </ul>
          <p>Ask by email, phone or post using the details above. We’ll reply within one month.</p>

          <h2 className="sect">Complaints</h2>
          <p>If you’re unhappy with how we’ve handled your information, please tell us first so we can put it right. You can also complain to the Information Commissioner’s Office: <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a> or 0303 123 1113.</p>
        </section>
      </main>
    </PageChrome>
  )
}
