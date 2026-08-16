---
layout: default
title: Anas Malas — Hardware Engineer
---

<section class="hero">
  <div class="site-shell hero-grid">
    <div>
      <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span> Hardware engineer · PCB design</p>
      <h1>Electronics that make it past the bench.</h1>
      <p class="hero-intro">I design, question, and document practical electronics—from the constraints hidden in a footprint to the trade-offs that decide whether a product works at scale.</p>
      <div class="hero-actions">
        <a class="button" href="#work">See selected work <span aria-hidden="true">↓</span></a>
        <a class="text-link" href="{{ '/notes/' | relative_url }}">Read engineering notes →</a>
      </div>
    </div>
    <aside class="signal-card" aria-label="Focus areas">
      <p class="signal-label">CURRENT SIGNAL</p>
      <p class="signal-title">Designing for the part you can’t see in the schematic.</p>
      <ul>
        <li>PCB layout &amp; stack-up</li>
        <li>Design for manufacture</li>
        <li>Hardware investigation</li>
      </ul>
    </aside>
  </div>
</section>

<section id="work" class="section site-shell">
  <div class="section-heading">
    <p class="eyebrow">Selected work</p>
    <h2>Small details. Real constraints.</h2>
    <p>Projects and experiments where the interesting part is the engineering decision, not the render.</p>
  </div>

  <div class="work-grid">
    <article class="work-card work-card-featured">
      <div class="card-index">01 / OPEN SOURCE</div>
      <h3>PCB edge USB-C</h3>
      <p>A slim USB-C connector footprint that uses the board edge itself—tested, documented, and released for KiCad and EasyEDA.</p>
      <div class="tag-list"><span>USB-C</span><span>Footprints</span><span>DFM</span></div>
      <a class="card-link" href="https://github.com/AnasMalas/pcb-edge-usb-c">Explore the repository <span aria-hidden="true">↗</span></a>
    </article>
    <article class="work-card">
      <div class="card-index">02 / DESIGN PRINCIPLE</div>
      <h3>Make the trade-off visible</h3>
      <p>Good hardware isn’t a collection of rules. It is knowing which constraint matters now: cost, return path, manufacturability, reliability, or time.</p>
      <a class="card-link" href="#notes">Read the notes <span aria-hidden="true">↓</span></a>
    </article>
  </div>
</section>

<section id="notes" class="notes-section">
  <div class="site-shell">
    <div class="section-heading section-heading-inline">
      <div>
        <p class="eyebrow">Engineering notes</p>
        <h2>Clear thinking, written down.</h2>
      </div>
      <a class="text-link" href="{{ '/notes/' | relative_url }}">All notes →</a>
    </div>
    <div class="note-list">
      {% assign published_posts = site.posts | where_exp: "post", "post.title != 'Blog Post Title From First Header'" %}
      {% for post in published_posts limit: 3 %}
      <article class="note-row">
        <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%Y.%m.%d" }}</time>
        <div>
          <p class="note-kind">{{ post.tags | first | default: "Engineering" }}</p>
          <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
        </div>
        <a class="arrow-link" href="{{ post.url | relative_url }}" aria-label="Read {{ post.title }}">↗</a>
      </article>
      {% endfor %}
    </div>
  </div>
</section>

<section id="about" class="section site-shell about-grid">
  <div>
    <p class="eyebrow">About</p>
    <h2>I’m interested in the “why” behind the layout.</h2>
  </div>
  <div class="about-copy">
    <p>I’m Anas, an electronics engineer focused on PCB design and the messy, satisfying gap between an idea and hardware that works reliably.</p>
    <p>The internet is full of conflicting design advice. I use this space to investigate it, share what I learn, and keep the reasoning attached to the rule.</p>
    <a class="text-link" href="https://www.linkedin.com/in/{{ site.linkedin_username }}/">More about my work on LinkedIn ↗</a>
  </div>
</section>
