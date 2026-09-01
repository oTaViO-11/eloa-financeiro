export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { status: 'ok', service: 'eloa-financeiro' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
