---
layout: layouts/note.njk
title: The cheapest connector was the board edge
description: A hotel-room teardown turned into a useful lesson in connector cost, assembly steps, and designing the PCB as part of the mechanism.
date: 2022-09-16
tags:
  - DFM
  - Connectors
  - Cost reduction
readTime: 5
permalink: /notes/cheap-connector/
heroImage:
  src: /assets/diagrams/rast-2-5-architecture.svg
  width: 1200
  height: 680
  alt: Simplified comparison of a conventional wire connector and a PCB-edge IDC connector.
  caption: A simplified diagram of the cost trade-off — the board edge becomes part of the connector.
---

I noticed the connector because a hotel-room mini fridge had a flickering light. The repair was simple; the useful part was the small board behind the plastic. A connector I had not seen before was doing two jobs at once: it was the electrical interface and part of the mechanical assembly.

This is a field observation, not a qualification report. The point is the design move: when a product is built at scale, a few eliminated parts and assembly operations can matter more than a clever schematic.

## The part that disappeared

The connector belonged to the RAST 2.5 family. Instead of putting a separate plastic receptacle on the PCB, the design uses the board edge itself as the mating feature. The plastic body locates the board, and the contacts engage the copper pattern at the edge.

That removes a component from the bill of materials and removes a soldering operation from the assembly flow. The PCB is no longer only an electrical carrier; its geometry is doing mechanical work too.

## The wire side is doing the same trick

The other half is an insulation-displacement connection, or IDC. A normal wire-to-board connection often needs a terminal crimped onto each wire and a housing to hold those terminals. IDC changes the sequence: the unstripped wire is placed in the connector, then a plunger cuts through the insulation and contacts the conductor.

It is a small but important distinction. The design is not just buying a cheaper connector. It is removing a terminal, a separate crimp operation, and some handling from the process.

<aside class="callout"><strong>The useful question:</strong> which part of this assembly is truly necessary, and which part exists only because the usual connector architecture expects it?</aside>

## What I would check before copying it

The cost-saving idea is attractive, but the PCB edge is now a product surface. Before using the pattern, I would verify:

- Board thickness, edge tolerance, plating, and the mating contact specification.
- How the connector is retained when the wire is pulled or the enclosure flexes.
- Clearance and creepage around the exposed edge, especially if the board carries anything more serious than low-voltage logic.
- Whether the connector can be inserted repeatedly without damaging the copper or solder mask.
- The assembly fixture: the connector may be cheap, but a difficult insertion step can give the saving back.

Those checks are where a component-level decision becomes a product-level decision.

## The lesson is bigger than one connector

Good design-for-manufacture work often looks unremarkable after the fact. A plastic part is gone. A crimp is gone. A screw is gone. The product still does the same job, but the factory has fewer opportunities to spend time, money, or error budget.

The interesting question is not “what is the cheapest part?” It is “what work can the product’s existing geometry do for free?” Sometimes the answer is hiding at the edge of the board.

<p class="source-note">The original teardown was first shared on <a href="https://www.linkedin.com/posts/anasmalas_electronics-costreduction-bomoptimization-activity-6976462523403264000-Qjrd" rel="noopener">LinkedIn</a>. The diagram above is a simplified explanation, not a manufacturer drawing.</p>
