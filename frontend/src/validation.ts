export function validPhone(value:string){return !value||(/^\+?[0-9 ()-]{7,20}$/.test(value.trim())&&value.replace(/\D/g,'').length>=7&&value.replace(/\D/g,'').length<=15);}
