let active = 0;
export async function withControlNotice(operation) {
  if (++active === 1) process.stderr.write('@control active\n');
  try {
    return await operation();
  } finally {
    if (--active === 0) process.stderr.write('@control idle\n');
  }
}
