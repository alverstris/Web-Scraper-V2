import { useState, type MouseEvent, type ReactNode } from 'react';
import { demoListings } from '../shared/fixtures';

type PublicSiteProps = { path: string; navigate: (path: string) => void; signedIn?: boolean };
type SiteLinkProps = { to: string; navigate: PublicSiteProps['navigate']; children: ReactNode; className?: string; current?: boolean; ariaLabel?: string };

function SiteLink({to,navigate,children,className,current,ariaLabel}:SiteLinkProps) {
  function follow(event:MouseEvent<HTMLAnchorElement>) {
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();navigate(to);
  }
  return <a href={to} onClick={follow} className={className} aria-current={current?'page':undefined} aria-label={ariaLabel}>{children}</a>;
}

function Arrow({small=false}:{small?:boolean}) {
  return <svg aria-hidden="true" width={small?16:20} height={small?16:20} viewBox="0 0 24 24" fill="none"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function BrandMark() {
  return <svg aria-hidden="true" width="34" height="34" viewBox="0 0 36 36" fill="none"><rect width="36" height="36" rx="11" fill="currentColor"/><path d="M12 24V13.5a3.5 3.5 0 0 1 7 0V24M12 19h7M19 19l5-5M21 17l3 3" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function HomeIllustration({variant=0}:{variant?:number}) {
  const palettes=[['#b7cdc6','#e8ddd0','#708d83'],['#d9c6b3','#f0e6d9','#9a735d'],['#bfcbd4','#eee8de','#6d8494']];
  const [wall,building,accent]=palettes[variant%palettes.length];
  return <svg className="kw-home-illustration" aria-hidden="true" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
    <rect width="320" height="180" fill={wall}/><circle cx="267" cy="34" r="26" fill="#fffaf0" opacity=".55"/>
    <path d="M0 132 62 115l42 13 64-17 60 18 92-13v64H0Z" fill={accent} opacity=".22"/>
    <path d="M49 66 132 39l80 23v118H49Z" fill={building}/><path d="m132 39 80 23v118h-80Z" fill={accent} opacity=".2"/>
    <path d="M35 70 132 35l92 29" stroke="#53665f" strokeWidth="7" strokeLinecap="round"/>
    {[72,112,157,188].map((x,index)=><g key={x}><rect x={x} y={index<2?84:80} width="19" height="29" rx="1" fill="#faf5e9"/><path d={`M${x+9.5} ${index<2?84:80}v29`} stroke={accent} strokeWidth="2"/></g>)}
    <rect x="78" y="135" width="32" height="45" rx="2" fill={accent}/><circle cx="103" cy="158" r="2" fill="#f9e8c8"/>
    <rect x="152" y="132" width="43" height="28" rx="1" fill="#faf5e9"/><path d="M173 132v28M148 162h51" stroke={accent} strokeWidth="3"/>
    <path d="M265 174V79" stroke="#586e61" strokeWidth="7"/><ellipse cx="265" cy="80" rx="33" ry="42" fill="#718d76"/><ellipse cx="246" cy="102" rx="23" ry="31" fill="#839d83"/>
    <path d="M0 174h320" stroke="#f3eee3" strokeWidth="12"/>
  </svg>;
}

const sampleHomes=[
  {listing:demoListings[1],title:'A bright apartment in Renens',commute:18,variant:0},
  {listing:demoListings[2],title:'Room to settle in Prilly',commute:24,variant:1},
  {listing:demoListings[4],title:'A home in Chavannes',commute:27,variant:2},
];

function SampleHome({index=0,compact=false}:{index?:number;compact?:boolean}) {
  const home=sampleHomes[index%sampleHomes.length];
  return <article className={`kw-sample-home${compact?' kw-sample-home-compact':''}`}>
    <div className="kw-sample-image"><HomeIllustration variant={home.variant}/><span className="kw-journey-badge"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 20 20" fill="none"><rect x="5" y="3" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 8h10M7 15l-1 2m7-2 1 2" stroke="currentColor" strokeWidth="1.5"/><circle cx="7.5" cy="12" r=".7" fill="currentColor"/><circle cx="12.5" cy="12" r=".7" fill="currentColor"/></svg>{home.commute} min</span></div>
    <div className="kw-sample-body"><h3>{home.title}</h3><p className="kw-sample-facts">{home.listing.rooms} rooms <span aria-hidden="true">·</span> {home.listing.floorArea} m²</p><p className="kw-sample-rent">CHF {home.listing.rent.amount?.toLocaleString('en-CH')} <span>/ month</span></p></div>
  </article>;
}

function CommutePreview() {
  return <section className="kw-commute-preview" aria-label="EPFL example search preview">
    <div className="kw-preview-heading"><span className="kw-preview-eyebrow">A little closer to your day</span><span className="kw-preview-dot" aria-hidden="true"/><h2>Homes near your routine.</h2><p>Getting to <strong>EPFL · west entrance</strong></p></div>
    <div className="kw-preview-map" aria-hidden="true"><svg viewBox="0 0 460 194" preserveAspectRatio="xMidYMid slice"><rect width="460" height="194" fill="#edf1e8"/><path d="M325 0 282 44l37 42-53 60 27 48h167V0Z" fill="#d5e7eb"/><g stroke="#fffdf7" strokeWidth="13" fill="none"><path d="M-20 53 70 81l102-41 120 57M39-20l22 76-2 138M-20 154l116-48 99 23 87-19M170-20l24 74-19 100 29 60M237-20l-5 85"/></g><g stroke="#d0d9cb" strokeWidth="1.5" fill="none"><path d="M-20 53 70 81l102-41 120 57M39-20l22 76-2 138M-20 154l116-48 99 23 87-19M170-20l24 74-19 100 29 60M237-20l-5 85"/></g><g fill="#d8e2d2"><rect x="85" y="25" width="24" height="29" rx="3"/><rect x="106" y="125" width="29" height="33" rx="3"/><rect x="210" y="119" width="30" height="32" rx="3"/><rect x="18" y="92" width="24" height="31" rx="3"/><rect x="117" y="60" width="27" height="29" rx="3"/></g></svg><span className="kw-map-pin kw-map-pin-one">18 min</span><span className="kw-map-pin kw-map-pin-two">24 min</span><span className="kw-map-pin kw-map-pin-three">27 min</span><span className="kw-map-destination">EPFL</span><span className="kw-map-caption">Illustrated overview</span></div>
    <SampleHome compact/><p className="kw-preview-note">Sample homes and journey times. No live availability.</p>
  </section>;
}

const steps=[
  {number:'01',title:'Start with your destination',body:'Your campus, workplace, or the place you need to be. Choose the exact destination that matters to your day.'},
  {number:'02',title:'Find your commute',body:'Choose how and when you travel. Review the journey settings before starting a custom search, or open a ready-made destination profile.'},
  {number:'03',title:'Make room for what matters',body:'Compare commute times, rent, rooms, and the details that make a place feel like home. Filters help you explore the same search.'},
];

function Steps({expanded=false}:{expanded?:boolean}) {
  return <ol className={`kw-steps${expanded?' kw-steps-expanded':''}`}>{steps.map(step=><li key={step.number}><span className="kw-step-number">{step.number}</span><h3>{step.title}</h3><p>{step.body}</p>{expanded&&<p className="kw-step-detail">{step.number==='01'?'Different entrances can mean different journeys. Confirm the place rather than relying on a nearby label.':step.number==='02'?'Changing your draft settings does not start another calculation. Your current results keep the settings and time they were created with.':'Unknown information stays unknown. Rooms and bedrooms remain separate, and shared facilities are identified as shared.'}</p>}</li>)}</ol>;
}

const destinations=[
  {name:'EPFL',profile:'epfl-west-transit',context:'West entrance · Ecublens',description:'A place to start your campus home search.',initials:'EP',tone:'sage'},
  {name:'UNIL',profile:'unil-dorigny-transit',context:'Dorigny · Lausanne',description:'Explore the housing trade-offs around your university day.',initials:'UN',tone:'sand'},
];

function DestinationCards({navigate,signedIn}:{navigate:PublicSiteProps['navigate'];signedIn:boolean}) {
  return <div className="kw-destination-grid">{destinations.map(destination=><article className="kw-destination-card" key={destination.name}><div className={`kw-destination-art kw-destination-art-${destination.tone}`} aria-hidden="true"><svg viewBox="0 0 420 180" fill="none"><path d="M0 133 52 119l76 16 62-13 62 18 94-26 74 13v53H0Z" fill="currentColor" opacity=".12"/><path d="M105 77h191v97H105Z" fill="#f9f6ec"/><path d="m94 81 107-39 107 39" stroke="currentColor" strokeWidth="8" strokeLinecap="round"/>{[122,158,194,230,266].map(x=><path key={x} d={`M${x} 96v63`} stroke="currentColor" strokeWidth="14" opacity=".35"/>)}<path d="M78 174h246" stroke="currentColor" strokeWidth="5"/><circle cx="51" cy="85" r="23" fill="currentColor" opacity=".26"/><path d="M51 105v62" stroke="currentColor" strokeWidth="5"/></svg><span>{destination.initials}</span></div><div className="kw-destination-body"><p className="kw-eyebrow">University destination</p><h3>{destination.name}</h3><p className="kw-destination-context">{destination.context}</p><p>{destination.description}</p><SiteLink to={(signedIn?'/dashboard':'/sign-in')+'?profile='+destination.profile} navigate={navigate} className="kw-inline-link">Explore {destination.name} homes <Arrow small/></SiteLink></div></article>)}</div>;
}

function HomePage({navigate,signedIn}:{navigate:PublicSiteProps['navigate'];signedIn:boolean}) {
  const next=signedIn?'/dashboard':'/sign-in';
  return <><section className="kw-hero kw-container"><div className="kw-hero-copy"><p className="kw-eyebrow"><span className="kw-small-line"/>A home search built around your day</p><h1>Find a home that fits your <em>commute.</em></h1><p className="kw-hero-intro">The right home is about more than an address. Start with where you need to be, then find a place that works for the life in between.</p><div className="kw-hero-actions"><SiteLink to={next} navigate={navigate} className="kw-button kw-button-primary">Find your home <Arrow/></SiteLink><SiteLink to="/how-it-works" navigate={navigate} className="kw-button kw-button-quiet">See how it works <Arrow small/></SiteLink></div><p className="kw-hero-footnote">Your destination. Your routine. Your kind of home.</p></div><CommutePreview/></section>
    <section className="kw-values-strip" aria-label="What you can compare"><div className="kw-container"><span><Arrow small/> Commute first</span><span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m3 11 9-8 9 8M6 9v12h12V9m-9 12v-7h6v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> Housing details that matter</span><span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> One search, room to explore</span></div></section>
    <section className="kw-section kw-container"><div className="kw-section-heading"><div><p className="kw-eyebrow">A clearer way to search</p><h2>From your destination<br/>to your front door.</h2></div><p>Less guessing about the journey.<br/>More space to find what suits you.</p></div><Steps/></section>
    <section className="kw-section kw-popular-section"><div className="kw-container"><div className="kw-section-heading"><div><p className="kw-eyebrow">A familiar place to start</p><h2>Popular destinations.</h2></div><SiteLink to="/popular-destinations" navigate={navigate} className="kw-inline-link">Explore destinations <Arrow small/></SiteLink></div><DestinationCards navigate={navigate} signedIn={signedIn}/></div></section>
    <section className="kw-section kw-container kw-bottom-cta"><div><p className="kw-eyebrow">Make the journey part of the decision</p><h2>A place to live.<br/>A day that works.</h2></div><div><p>Bring your destination. We’ll help you see the housing trade-offs around it.</p><SiteLink to={next} navigate={navigate} className="kw-button kw-button-primary">Start your search <Arrow/></SiteLink></div></section>
  </>;
}

function HowItWorksPage({navigate,signedIn}:{navigate:PublicSiteProps['navigate'];signedIn:boolean}) {
  return <><section className="kw-page-intro kw-container"><p className="kw-eyebrow">How it works</p><h1>A home search that starts<br/>with your journey.</h1><p>Choose where you need to be. Understand the commute. Then make the housing decision yours.</p></section><section className="kw-section kw-container"><Steps expanded/></section><section className="kw-section kw-soft-section"><div className="kw-container kw-explanation-grid"><div><p className="kw-eyebrow">Two ways to get started</p><h2>A familiar destination,<br/>or a place of your own.</h2></div><div><article><h3>Browse a popular destination</h3><p>Explore an available profile for a specific destination, travel mode, and journey time. Sign in to open the workspace and compare its homes.</p><SiteLink to="/popular-destinations" navigate={navigate} className="kw-inline-link">See popular destinations <Arrow small/></SiteLink></article><article><h3>Choose your own commute</h3><p>Confirm your destination and select how and when you travel. You review the coverage and allowance before explicitly starting a custom calculation.</p><SiteLink to={signedIn?'/dashboard':'/sign-in'} navigate={navigate} className="kw-inline-link">Set up your search <Arrow small/></SiteLink></article></div></div></section><section className="kw-section kw-container kw-clarity"><h2>The details stay clear.</h2><div className="kw-clarity-grid"><article><h3>Your search, your filters</h3><p>Changing rent, rooms or facilities explores the current results. It does not quietly start another commute calculation.</p></article><article><h3>Time and uncertainty matter</h3><p>Every search keeps its original journey assumptions visible. Missing routes and unknown property facts stay distinct from confirmed information.</p></article><article><h3>Go to the original listing</h3><p>When a home catches your eye, open its source to take the next step. The local preview uses illustrative homes and a sample source page.</p></article></div></section></>;
}

function PopularPage({navigate,signedIn}:{navigate:PublicSiteProps['navigate'];signedIn:boolean}) {
  return <><section className="kw-page-intro kw-container"><p className="kw-eyebrow">Popular destinations</p><h1>Start somewhere<br/><em>you know.</em></h1><p>A campus. A daily routine. A place you need to reach. Preview these destinations, then sign in to explore their available search profiles.</p></section><section className="kw-section kw-container kw-popular-page"><DestinationCards navigate={navigate} signedIn={signedIn}/><p className="kw-sample-disclosure">These are illustrative destination previews. The local workspace uses sample homes and journeys, with each search’s coverage and calculation time shown.</p></section><section className="kw-section kw-soft-section"><div className="kw-container"><div className="kw-section-heading"><div><p className="kw-eyebrow">An EPFL home search, at a glance</p><h2>A shorter journey is<br/>one part of the picture.</h2></div><p>Compare the commute alongside<br/>the space and rent that suit you.</p></div><div className="kw-sample-grid">{sampleHomes.map((home,index)=><SampleHome key={home.listing.id} index={index}/>)}</div><div className="kw-preview-actions"><p>Sample listings and commute figures. No live availability.</p><SiteLink to={signedIn?'/dashboard':'/sign-in'} navigate={navigate} className="kw-button kw-button-primary">{signedIn?'Open your workspace':'Sign in to filter homes'} <Arrow/></SiteLink></div></div></section><section className="kw-section kw-container kw-bottom-cta"><div><h2>Have somewhere<br/>else in mind?</h2></div><div><p>Sign in to choose a custom destination or suggest a place for future popular profiles.</p><SiteLink to={signedIn?'/dashboard':'/sign-in'} navigate={navigate} className="kw-inline-link">Make it your search <Arrow/></SiteLink></div></section></>;
}

const questions=[
  {title:'Can I look around before signing in?',answer:'Yes. Explore these pages and destination previews without an account. Sign in to open your search workspace, filter homes, create a custom commute, or manage saved results.'},
  {title:'What is a custom commute search?',answer:'It is one calculation for the exact destination, travel mode and journey time you confirm. You review its supported coverage and your available allowance before starting. Editing a draft never starts a run by itself.'},
  {title:'Does changing a housing filter use another run?',answer:'No. Rent, rooms, facilities, sorting and geographic view filters explore the results already loaded. A new commute definition needs a separate explicit calculation.'},
  {title:'How should I compare the rent?',answer:'Check the listed currency, weekly or monthly period, and any stated extra charges. Rent filters use the source amounts without converting currencies or billing periods. Unknown charges are not assumed to be zero.'},
  {title:'What if a property has no commute time?',answer:'A suitable journey may not have been found, the property location may be too imprecise, or calculation may be unavailable. These outcomes are shown separately and do not appear as zero-minute journeys.'},
  {title:'Are saved results current listings?',answer:'You can reopen a saved search without signing in. Its snapshot keeps the original property facts and journey assumptions, without checking current availability or calculating fresh routes. Follow the source listing for the next step.'},
  {title:'Are the homes in this preview real?',answer:'The current local experience uses illustrative properties, journey times and sign-in. Source pages are simulated too. It lets you try the search journey; it is not a live housing feed.'},
];

function HelpPage({navigate,signedIn}:{navigate:PublicSiteProps['navigate'];signedIn:boolean}) {
  return <><section className="kw-page-intro kw-container"><p className="kw-eyebrow">Help</p><h1>A few useful answers.</h1><p>Understand your search, your results, and what happens next.</p></section><section className="kw-section kw-container kw-help-layout"><div><div className="kw-faqs">{questions.map(question=><details key={question.title}><summary>{question.title}<span aria-hidden="true">+</span></summary><p>{question.answer}</p></details>)}</div><div className="kw-snapshot-help"><h2>Have a saved search?</h2><p>Reopen its properties and journey assumptions locally, without signing in or starting a new calculation.</p><SiteLink to="/open-snapshot" navigate={navigate} className="kw-inline-link">Open a saved search snapshot <Arrow small/></SiteLink></div></div><aside className="kw-support-card"><span className="kw-support-icon" aria-hidden="true">?</span><h2>Need help with<br/>your account?</h2><p>Sign in to review your access, allowance or existing support requests. Your account includes a way to contact support.</p><SiteLink to={signedIn?'/dashboard':'/sign-in'} navigate={navigate} className="kw-button kw-button-primary">{signedIn?'Open your account':'Sign in for account help'} <Arrow small/></SiteLink></aside></section><section className="kw-section kw-container kw-bottom-cta"><div><h2>Ready to find<br/>your starting point?</h2></div><SiteLink to="/popular-destinations" navigate={navigate} className="kw-inline-link">Explore destinations <Arrow/></SiteLink></section></>;
}

export function PublicSite({path,navigate,signedIn=false}:PublicSiteProps) {
  const [menuOpen,setMenuOpen]=useState(false);
  const route=path.split('?')[0].replace(/\/$/,'')||'/';
  const links=[{to:'/how-it-works',label:'How it works'},{to:'/popular-destinations',label:'Popular destinations'},{to:'/help',label:'Help'}];
  function go(next:string){setMenuOpen(false);navigate(next);}
  return <div className="kw-site"><a className="kw-skip-link" href="#kw-main">Skip to content</a><header className="kw-site-header"><div className="kw-container kw-header-inner"><SiteLink to="/" navigate={go} className="kw-brand" ariaLabel="Keywise home"><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></SiteLink><button className="kw-menu-toggle" aria-expanded={menuOpen} aria-controls="kw-public-navigation" onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?'Close menu':'Menu'}<span aria-hidden="true">{menuOpen?'×':'≡'}</span></button><nav className={`kw-public-nav${menuOpen?' kw-nav-open':''}`} id="kw-public-navigation" aria-label="Main navigation">{links.map(link=><SiteLink key={link.to} to={link.to} navigate={go} current={route===link.to}>{link.label}</SiteLink>)}</nav><SiteLink to={signedIn?'/dashboard':'/sign-in'} navigate={go} className="kw-header-sign-in">{signedIn?'Open dashboard':'Sign in'}<Arrow small/></SiteLink></div></header><main id="kw-main" tabIndex={-1}>{route==='/'?<HomePage navigate={go} signedIn={signedIn}/>:route==='/how-it-works'?<HowItWorksPage navigate={go} signedIn={signedIn}/>:route==='/popular-destinations'?<PopularPage navigate={go} signedIn={signedIn}/>:route==='/help'?<HelpPage navigate={go} signedIn={signedIn}/>:<section className="kw-page-intro kw-container"><p className="kw-eyebrow">Page unavailable</p><h1>Let’s find your way back.</h1><p>This page could not be found.</p><SiteLink to="/" navigate={go} className="kw-button kw-button-primary">Go to Keywise home <Arrow/></SiteLink></section>}</main><footer className="kw-site-footer"><div className="kw-container"><div className="kw-footer-main"><div><SiteLink to="/" navigate={go} className="kw-brand" ariaLabel="Keywise home"><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></SiteLink><p>Homes, with your day in mind.</p></div><nav aria-label="Footer navigation">{links.map(link=><SiteLink key={link.to} to={link.to} navigate={go}>{link.label}</SiteLink>)}<SiteLink to="/open-snapshot" navigate={go}>Open a saved search</SiteLink></nav></div><div className="kw-footer-bottom"><p>Keywise · Local product preview</p><SiteLink to="/staff/sign-in" navigate={go} className="kw-staff-link">Staff sign in</SiteLink></div></div></footer></div>;
}
