// Supabase 접속 정보.
// URL과 publishable key(sb_publishable_...)는 브라우저에 노출되도록 설계된 공개 값이다.
// 데이터 보호는 키가 아니라 DB의 Row Level Security 정책이 담당한다.
// 서버 전용 키(sb_secret_..., service_role)는 이 저장소 어디에도 넣지 않는다.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://paeyplmqzysktpbedegz.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SWObppJPWTsi3ucTLcZhbQ_SnouxGJR';
