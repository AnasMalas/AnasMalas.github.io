---
layout: default
title: Engineering Notes
permalink: /notes/
---

<section class="archive-header site-shell">
  <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span> Archive</p>
  <h1>Engineering notes</h1>
  <p>Short, practical observations on electronics, PCB design, and the decisions behind reliable hardware.</p>
</section>

<section class="archive-list site-shell">
  {% assign published_posts = site.posts | where_exp: "post", "post.title != 'Blog Post Title From First Header'" %}
  {% for post in published_posts %}
  <article class="archive-row">
    <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%d %b %Y" }}</time>
    <div>
      <p class="note-kind">{{ post.tags | first | default: "Engineering" }}</p>
      <h2><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h2>
    </div>
    <a class="arrow-link" href="{{ post.url | relative_url }}" aria-label="Read {{ post.title }}">↗</a>
  </article>
  {% endfor %}
</section>
