import {deleteManagedUserApi} from '../../../../../lib/user-deletion-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request:Request){return deleteManagedUserApi(request);}
