function bookingStartMin(scheduledAt) {
  const d = new Date(scheduledAt);
  return d.getHours() * 60 + d.getMinutes();
}

function bookingEndMin(booking) {
  return bookingStartMin(booking.scheduled_at) + (booking.duration_min || 30);
}

function bookingsOverlap(a, b) {
  const a0 = bookingStartMin(a.scheduled_at);
  const a1 = bookingEndMin(a);
  const b0 = bookingStartMin(b.scheduled_at);
  const b1 = bookingEndMin(b);
  return a1 > b0 && a0 < b1;
}

/**
 * Assign column index + count for overlapping bookings on the same staff row.
 * @returns {Map<string, { column: number, columns: number, hasOverlap: boolean }>}
 */
export function layoutOverlappingBookings(bookings) {
  const sorted = [...bookings].sort(
    (a, b) => bookingStartMin(a.scheduled_at) - bookingStartMin(b.scheduled_at),
  );
  const layout = new Map();
  const clusters = [];

  for (const b of sorted) {
    let cluster = clusters.find((c) => c.some((x) => bookingsOverlap(x, b)));
    if (!cluster) {
      cluster = [];
      clusters.push(cluster);
    }
    cluster.push(b);
  }

  for (const cluster of clusters) {
    const columns = [];
    for (const b of cluster) {
      let col = 0;
      while (columns[col]?.some((x) => bookingsOverlap(x, b))) col += 1;
      if (!columns[col]) columns[col] = [];
      columns[col].push(b);
      layout.set(b.id, {
        column: col,
        columns: 0,
        hasOverlap: cluster.length > 1,
      });
    }
    const colCount = columns.length;
    for (const b of cluster) {
      const entry = layout.get(b.id);
      if (entry) entry.columns = colCount;
    }
  }

  for (const b of sorted) {
    if (!layout.has(b.id)) {
      layout.set(b.id, { column: 0, columns: 1, hasOverlap: false });
    }
  }

  return layout;
}
