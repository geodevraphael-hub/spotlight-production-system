export function validGpsCoordinates(latitude,longitude) {
  if(latitude===''||longitude===''||latitude==null||longitude==null)return false;
  const lat=Number(latitude),lng=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
}
