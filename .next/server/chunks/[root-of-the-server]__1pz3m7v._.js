module.exports=[33405,(e,t,r)=>{t.exports=e.x("child_process",()=>require("child_process"))},92509,(e,t,r)=>{t.exports=e.x("url",()=>require("url"))},37702,(e,t,r)=>{t.exports=e.x("worker_threads",()=>require("worker_threads"))},52174,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0})},24284,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronField=void 0,r.CronField=class e{#e=!1;#t=!1;#r=!1;#n=[];options={rawValue:""};static get min(){throw Error("min must be overridden")}static get max(){throw Error("max must be overridden")}static get chars(){return Object.freeze([])}static get validChars(){return/^[?,*\dH/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/}static get constraints(){return{min:this.min,max:this.max,chars:this.chars,validChars:this.validChars}}constructor(t,r={rawValue:""}){if(!Array.isArray(t))throw Error(`${this.constructor.name} Validation error, values is not an array`);if(!(t.length>0))throw Error(`${this.constructor.name} Validation error, values contains no values`);this.options={...r,rawValue:r.rawValue??""},this.#n=[...t].sort(e.sorter),this.#r=void 0!==this.options.wildcard?this.options.wildcard:this.#i(),this.#e=this.options.rawValue.includes("L")||t.includes("L"),this.#t=this.options.rawValue.includes("?")||t.includes("?")}get min(){return this.constructor.min}get max(){return this.constructor.max}get chars(){return this.constructor.chars}get hasLastChar(){return this.#e}get hasQuestionMarkChar(){return this.#t}get isWildcard(){return this.#r}get values(){return this.#n}static sorter(e,t){let r="number"==typeof e,n="number"==typeof t;return r&&n?e-t:r||n?r?-1:1:e.localeCompare(t)}static findNearestValueInList(e,t,r){if(r){for(let r=e.length-1;r>=0;r--)if(e[r]<t)return e[r];return null}for(let r=0;r<e.length;r++)if(e[r]>t)return e[r];return null}findNearestValue(e,t){return this.constructor.findNearestValueInList(this.values,e,t)}serialize(){return{wildcard:this.#r,values:this.#n}}validate(){let e,t=this.chars.length>0?` or chars ${this.chars.join("")}`:"",r=t=>(e=t,"number"==typeof t?t>=this.min&&t<=this.max:this.chars.some(e=>RegExp(`^\\d{0,2}${e}$`).test(t)));if(!this.#n.every(r))throw Error(`${this.constructor.name} Validation error, got value ${e} expected range ${this.min}-${this.max}${t}`);let n=this.#n.find((e,t)=>this.#n.indexOf(e)!==t);if(void 0!==n)throw Error(`${this.constructor.name} Validation error, duplicate values found: ${n}`)}#i(){return this.options.rawValue.length>0?["*","?"].includes(this.options.rawValue):Array.from({length:this.max-this.min+1},(e,t)=>t+this.min).every(e=>this.#n.includes(e))}}},95057,(e,t,r)=>{"use strict";let n;Object.defineProperty(r,"__esModule",{value:!0});class i extends Error{}class a extends i{constructor(e){super(`Invalid DateTime: ${e.toMessage()}`)}}class s extends i{constructor(e){super(`Invalid Interval: ${e.toMessage()}`)}}class o extends i{constructor(e){super(`Invalid Duration: ${e.toMessage()}`)}}class l extends i{}class d extends i{constructor(e){super(`Invalid unit ${e}`)}}class c extends i{}class u extends i{constructor(){super("Zone is an abstract class")}}let h="numeric",p="short",m="long",y={year:h,month:h,day:h},f={year:h,month:p,day:h},b={year:h,month:p,day:h,weekday:p},g={year:h,month:m,day:h},K={year:h,month:m,day:h,weekday:m},v={hour:h,minute:h},E={hour:h,minute:h,second:h},I={hour:h,minute:h,second:h,timeZoneName:p},w={hour:h,minute:h,second:h,timeZoneName:m},S={hour:h,minute:h,hourCycle:"h23"},k={hour:h,minute:h,second:h,hourCycle:"h23"},j={hour:h,minute:h,second:h,hourCycle:"h23",timeZoneName:p},x={hour:h,minute:h,second:h,hourCycle:"h23",timeZoneName:m},D={year:h,month:h,day:h,hour:h,minute:h},C={year:h,month:h,day:h,hour:h,minute:h,second:h},T={year:h,month:p,day:h,hour:h,minute:h},O={year:h,month:p,day:h,hour:h,minute:h,second:h},R={year:h,month:p,day:h,weekday:p,hour:h,minute:h},A={year:h,month:m,day:h,hour:h,minute:h,timeZoneName:p},M={year:h,month:m,day:h,hour:h,minute:h,second:h,timeZoneName:p},N={year:h,month:m,day:h,weekday:m,hour:h,minute:h,timeZoneName:m},P={year:h,month:m,day:h,weekday:m,hour:h,minute:h,second:h,timeZoneName:m};class J{get type(){throw new u}get name(){throw new u}get ianaName(){return this.name}get isUniversal(){throw new u}offsetName(e,t){throw new u}formatOffset(e,t){throw new u}offset(e){throw new u}equals(e){throw new u}get isValid(){throw new u}}let L=null;class q extends J{static get instance(){return null===L&&(L=new q),L}get type(){return"system"}get name(){return new Intl.DateTimeFormat().resolvedOptions().timeZone}get isUniversal(){return!1}offsetName(e,{format:t,locale:r}){return e4(e,t,r)}formatOffset(e,t){return e9(this.offset(e),t)}offset(e){return-new Date(e).getTimezoneOffset()}equals(e){return"system"===e.type}get isValid(){return!0}}let F=new Map,V={year:0,month:1,day:2,era:3,hour:4,minute:5,second:6},_=new Map;class G extends J{static create(e){let t=_.get(e);return void 0===t&&_.set(e,t=new G(e)),t}static resetCache(){_.clear(),F.clear()}static isValidSpecifier(e){return this.isValidZone(e)}static isValidZone(e){if(!e)return!1;try{return new Intl.DateTimeFormat("en-US",{timeZone:e}).format(),!0}catch(e){return!1}}constructor(e){super(),this.zoneName=e,this.valid=G.isValidZone(e)}get type(){return"iana"}get name(){return this.zoneName}get isUniversal(){return!1}offsetName(e,{format:t,locale:r}){return e4(e,t,r,this.name)}formatOffset(e,t){return e9(this.offset(e),t)}offset(e){var t;let r;if(!this.valid)return NaN;let n=new Date(e);if(isNaN(n))return NaN;let i=(t=this.name,void 0===(r=F.get(t))&&(r=new Intl.DateTimeFormat("en-US",{hour12:!1,timeZone:t,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",era:"short"}),F.set(t,r)),r),[a,s,o,l,d,c,u]=i.formatToParts?function(e,t){let r=e.formatToParts(t),n=[];for(let e=0;e<r.length;e++){let{type:t,value:i}=r[e],a=V[t];"era"===t?n[a]=i:eJ(a)||(n[a]=parseInt(i,10))}return n}(i,n):function(e,t){let r=e.format(t).replace(/\u200E/g,""),[,n,i,a,s,o,l,d]=/(\d+)\/(\d+)\/(\d+) (AD|BC),? (\d+):(\d+):(\d+)/.exec(r);return[a,n,i,s,o,l,d]}(i,n);"BC"===l&&(a=-Math.abs(a)+1);let h=e0({year:a,month:s,day:o,hour:24===d?0:d,minute:c,second:u,millisecond:0}),p=+n,m=p%1e3;return(h-(p-=m>=0?m:1e3+m))/6e4}equals(e){return"iana"===e.type&&e.name===this.name}get isValid(){return this.valid}}let Y={},$=new Map;function W(e,t={}){let r=JSON.stringify([e,t]),n=$.get(r);return void 0===n&&(n=new Intl.DateTimeFormat(e,t),$.set(r,n)),n}let U=new Map,z=new Map,H=null,B=new Map;function Z(e){let t=B.get(e);return void 0===t&&(t=new Intl.DateTimeFormat(e).resolvedOptions(),B.set(e,t)),t}let X=new Map;function Q(e,t,r,n){let i=e.listingMode();return"error"===i?null:"en"===i?r(t):n(t)}class ee{constructor(e,t,r){this.padTo=r.padTo||0,this.floor=r.floor||!1;const{padTo:n,floor:i,...a}=r;if(!t||Object.keys(a).length>0){const t={useGrouping:!1,...r};r.padTo>0&&(t.minimumIntegerDigits=r.padTo),this.inf=function(e,t={}){let r=JSON.stringify([e,t]),n=U.get(r);return void 0===n&&(n=new Intl.NumberFormat(e,t),U.set(r,n)),n}(e,t)}}format(e){if(!this.inf)return eW(this.floor?Math.floor(e):eB(e,3),this.padTo);{let t=this.floor?Math.floor(e):e;return this.inf.format(t)}}}class et{constructor(e,t,r){let n;if(this.opts=r,this.originalZone=void 0,this.opts.timeZone)this.dt=e;else if("fixed"===e.zone.type){const t=-1*(e.offset/60),r=t>=0?`Etc/GMT+${t}`:`Etc/GMT${t}`;0!==e.offset&&G.create(r).valid?(n=r,this.dt=e):(n="UTC",this.dt=0===e.offset?e:e.setZone("UTC").plus({minutes:e.offset}),this.originalZone=e.zone)}else"system"===e.zone.type?this.dt=e:"iana"===e.zone.type?(this.dt=e,n=e.zone.name):(n="UTC",this.dt=e.setZone("UTC").plus({minutes:e.offset}),this.originalZone=e.zone);const i={...this.opts};i.timeZone=i.timeZone||n,this.dtf=W(t,i)}format(){return this.originalZone?this.formatToParts().map(({value:e})=>e).join(""):this.dtf.format(this.dt.toJSDate())}formatToParts(){let e=this.dtf.formatToParts(this.dt.toJSDate());return this.originalZone?e.map(e=>{if("timeZoneName"!==e.type)return e;{let t=this.originalZone.offsetName(this.dt.ts,{locale:this.dt.locale,format:this.opts.timeZoneName});return{...e,value:t}}}):e}resolvedOptions(){return this.dtf.resolvedOptions()}}class er{constructor(e,t,r){this.opts={style:"long",...r},!t&&eF()&&(this.rtf=function(e,t={}){let{base:r,...n}=t,i=JSON.stringify([e,n]),a=z.get(i);return void 0===a&&(a=new Intl.RelativeTimeFormat(e,t),z.set(i,a)),a}(e,r))}format(e,t){return this.rtf?this.rtf.format(e,t):function(e,t,r="always",n=!1){let i={years:["year","yr."],quarters:["quarter","qtr."],months:["month","mo."],weeks:["week","wk."],days:["day","day","days"],hours:["hour","hr."],minutes:["minute","min."],seconds:["second","sec."]},a=-1===["hours","minutes","seconds"].indexOf(e);if("auto"===r&&a){let r="days"===e;switch(t){case 1:return r?"tomorrow":`next ${i[e][0]}`;case -1:return r?"yesterday":`last ${i[e][0]}`;case 0:return r?"today":`this ${i[e][0]}`}}let s=Object.is(t,-0)||t<0,o=Math.abs(t),l=1===o,d=i[e],c=n?l?d[1]:d[2]||d[1]:l?i[e][0]:e;return s?`${o} ${c} ago`:`in ${o} ${c}`}(t,e,this.opts.numeric,"long"!==this.opts.style)}formatToParts(e,t){return this.rtf?this.rtf.formatToParts(e,t):[]}}let en={firstDay:1,minimalDays:4,weekend:[6,7]};class ei{static fromOpts(e){return ei.create(e.locale,e.numberingSystem,e.outputCalendar,e.weekSettings,e.defaultToEN)}static create(e,t,r,n,i=!1){let a=e||eI.defaultLocale;return new ei(a||(i?"en-US":H||(H=new Intl.DateTimeFormat().resolvedOptions().locale)),t||eI.defaultNumberingSystem,r||eI.defaultOutputCalendar,eY(n)||eI.defaultWeekSettings,a)}static resetCache(){H=null,$.clear(),U.clear(),z.clear(),B.clear(),X.clear()}static fromObject({locale:e,numberingSystem:t,outputCalendar:r,weekSettings:n}={}){return ei.create(e,t,r,n)}constructor(e,t,r,n,i){const[a,s,o]=function(e){let t=e.indexOf("-x-");-1!==t&&(e=e.substring(0,t));let r=e.indexOf("-u-");if(-1===r)return[e];{let t,n;try{t=W(e).resolvedOptions(),n=e}catch(a){let i=e.substring(0,r);t=W(i).resolvedOptions(),n=i}let{numberingSystem:i,calendar:a}=t;return[n,i,a]}}(e);this.locale=a,this.numberingSystem=t||s||null,this.outputCalendar=r||o||null,this.weekSettings=n,this.intl=function(e,t,r){return(r||t)&&(e.includes("-u-")||(e+="-u"),r&&(e+=`-ca-${r}`),t&&(e+=`-nu-${t}`)),e}(this.locale,this.numberingSystem,this.outputCalendar),this.weekdaysCache={format:{},standalone:{}},this.monthsCache={format:{},standalone:{}},this.meridiemCache=null,this.eraCache={},this.specifiedLocale=i,this.fastNumbersCached=null}get fastNumbers(){return null==this.fastNumbersCached&&(this.fastNumbersCached=(!this.numberingSystem||"latn"===this.numberingSystem)&&("latn"===this.numberingSystem||!this.locale||this.locale.startsWith("en")||"latn"===Z(this.locale).numberingSystem)),this.fastNumbersCached}listingMode(){let e=this.isEnglish(),t=(null===this.numberingSystem||"latn"===this.numberingSystem)&&(null===this.outputCalendar||"gregory"===this.outputCalendar);return e&&t?"en":"intl"}clone(e){return e&&0!==Object.getOwnPropertyNames(e).length?ei.create(e.locale||this.specifiedLocale,e.numberingSystem||this.numberingSystem,e.outputCalendar||this.outputCalendar,eY(e.weekSettings)||this.weekSettings,e.defaultToEN||!1):this}redefaultToEN(e={}){return this.clone({...e,defaultToEN:!0})}redefaultToSystem(e={}){return this.clone({...e,defaultToEN:!1})}months(e,t=!1){return Q(this,e,tn,()=>{let r="ja"===this.intl||this.intl.startsWith("ja-"),n=(t&=!r)?{month:e,day:"numeric"}:{month:e},i=t?"format":"standalone";if(!this.monthsCache[i][e]){let t=r?e=>this.dtFormatter(e,n).format():e=>this.extract(e,n,"month");this.monthsCache[i][e]=function(e){let t=[];for(let r=1;r<=12;r++){let n=rz.utc(2009,r,1);t.push(e(n))}return t}(t)}return this.monthsCache[i][e]})}weekdays(e,t=!1){return Q(this,e,to,()=>{let r=t?{weekday:e,year:"numeric",month:"long",day:"numeric"}:{weekday:e},n=t?"format":"standalone";return this.weekdaysCache[n][e]||(this.weekdaysCache[n][e]=function(e){let t=[];for(let r=1;r<=7;r++){let n=rz.utc(2016,11,13+r);t.push(e(n))}return t}(e=>this.extract(e,r,"weekday"))),this.weekdaysCache[n][e]})}meridiems(){return Q(this,void 0,()=>tl,()=>{if(!this.meridiemCache){let e={hour:"numeric",hourCycle:"h12"};this.meridiemCache=[rz.utc(2016,11,13,9),rz.utc(2016,11,13,19)].map(t=>this.extract(t,e,"dayperiod"))}return this.meridiemCache})}eras(e){return Q(this,e,th,()=>{let t={era:e};return this.eraCache[e]||(this.eraCache[e]=[rz.utc(-40,1,1),rz.utc(2017,1,1)].map(e=>this.extract(e,t,"era"))),this.eraCache[e]})}extract(e,t,r){let n=this.dtFormatter(e,t).formatToParts().find(e=>e.type.toLowerCase()===r);return n?n.value:null}numberFormatter(e={}){return new ee(this.intl,e.forceSimple||this.fastNumbers,e)}dtFormatter(e,t={}){return new et(e,this.intl,t)}relFormatter(e={}){return new er(this.intl,this.isEnglish(),e)}listFormatter(e={}){return function(e,t={}){let r=JSON.stringify([e,t]),n=Y[r];return n||(n=new Intl.ListFormat(e,t),Y[r]=n),n}(this.intl,e)}isEnglish(){return"en"===this.locale||"en-us"===this.locale.toLowerCase()||Z(this.intl).locale.startsWith("en-us")}getWeekSettings(){if(this.weekSettings)return this.weekSettings;if(!eV())return en;var e=this.locale;let t=X.get(e);if(!t){let r=new Intl.Locale(e);"minimalDays"in(t="getWeekInfo"in r?r.getWeekInfo():r.weekInfo)||(t={...en,...t}),X.set(e,t)}return t}getStartOfWeek(){return this.getWeekSettings().firstDay}getMinDaysInFirstWeek(){return this.getWeekSettings().minimalDays}getWeekendDays(){return this.getWeekSettings().weekend}equals(e){return this.locale===e.locale&&this.numberingSystem===e.numberingSystem&&this.outputCalendar===e.outputCalendar}toString(){return`Locale(${this.locale}, ${this.numberingSystem}, ${this.outputCalendar})`}}let ea=null;class es extends J{static get utcInstance(){return null===ea&&(ea=new es(0)),ea}static instance(e){return 0===e?es.utcInstance:new es(e)}static parseSpecifier(e){if(e){let t=e.match(/^utc(?:([+-]\d{1,2})(?::(\d{2}))?)?$/i);if(t)return new es(e6(t[1],t[2]))}return null}constructor(e){super(),this.fixed=e}get type(){return"fixed"}get name(){return 0===this.fixed?"UTC":`UTC${e9(this.fixed,"narrow")}`}get ianaName(){return 0===this.fixed?"Etc/UTC":`Etc/GMT${e9(-this.fixed,"narrow")}`}offsetName(){return this.name}formatOffset(e,t){return e9(this.fixed,t)}get isUniversal(){return!0}offset(){return this.fixed}equals(e){return"fixed"===e.type&&e.fixed===this.fixed}get isValid(){return!0}}class eo extends J{constructor(e){super(),this.zoneName=e}get type(){return"invalid"}get name(){return this.zoneName}get isUniversal(){return!1}offsetName(){return null}formatOffset(){return""}offset(){return NaN}equals(){return!1}get isValid(){return!1}}function el(e,t){if(eJ(e)||null===e)return t;if(e instanceof J)return e;if("string"==typeof e){let r=e.toLowerCase();return"default"===r?t:"local"===r||"system"===r?q.instance:"utc"===r||"gmt"===r?es.utcInstance:es.parseSpecifier(r)||G.create(e)}if(eL(e))return es.instance(e);if("object"==typeof e&&"offset"in e&&"function"==typeof e.offset)return e;else return new eo(e)}let ed={arab:"[٠-٩]",arabext:"[۰-۹]",bali:"[᭐-᭙]",beng:"[০-৯]",deva:"[०-९]",fullwide:"[０-９]",gujr:"[૦-૯]",hanidec:"[〇|一|二|三|四|五|六|七|八|九]",khmr:"[០-៩]",knda:"[೦-೯]",laoo:"[໐-໙]",limb:"[᥆-᥏]",mlym:"[൦-൯]",mong:"[᠐-᠙]",mymr:"[၀-၉]",orya:"[୦-୯]",tamldec:"[௦-௯]",telu:"[౦-౯]",thai:"[๐-๙]",tibt:"[༠-༩]",latn:"\\d"},ec={arab:[1632,1641],arabext:[1776,1785],bali:[6992,7001],beng:[2534,2543],deva:[2406,2415],fullwide:[65296,65303],gujr:[2790,2799],khmr:[6112,6121],knda:[3302,3311],laoo:[3792,3801],limb:[6470,6479],mlym:[3430,3439],mong:[6160,6169],mymr:[4160,4169],orya:[2918,2927],tamldec:[3046,3055],telu:[3174,3183],thai:[3664,3673],tibt:[3872,3881]},eu=ed.hanidec.replace(/[\[|\]]/g,"").split(""),eh=new Map;function ep({numberingSystem:e},t=""){let r=e||"latn",n=eh.get(r);void 0===n&&(n=new Map,eh.set(r,n));let i=n.get(t);return void 0===i&&(i=RegExp(`${ed[r]}${t}`),n.set(t,i)),i}let em=()=>Date.now(),ey="system",ef=null,eb=null,eg=null,eK=60,ev,eE=null;class eI{static get now(){return em}static set now(e){em=e}static set defaultZone(e){ey=e}static get defaultZone(){return el(ey,q.instance)}static get defaultLocale(){return ef}static set defaultLocale(e){ef=e}static get defaultNumberingSystem(){return eb}static set defaultNumberingSystem(e){eb=e}static get defaultOutputCalendar(){return eg}static set defaultOutputCalendar(e){eg=e}static get defaultWeekSettings(){return eE}static set defaultWeekSettings(e){eE=eY(e)}static get twoDigitCutoffYear(){return eK}static set twoDigitCutoffYear(e){eK=e%100}static get throwOnInvalid(){return ev}static set throwOnInvalid(e){ev=e}static resetCaches(){ei.resetCache(),G.resetCache(),rz.resetCache(),eh.clear()}}class ew{constructor(e,t){this.reason=e,this.explanation=t}toMessage(){return this.explanation?`${this.reason}: ${this.explanation}`:this.reason}}let eS=[0,31,59,90,120,151,181,212,243,273,304,334],ek=[0,31,60,91,121,152,182,213,244,274,305,335];function ej(e,t){return new ew("unit out of range",`you specified ${t} (of type ${typeof t}) as a ${e}, which is invalid`)}function ex(e,t,r){let n=new Date(Date.UTC(e,t-1,r));e<100&&e>=0&&n.setUTCFullYear(n.getUTCFullYear()-1900);let i=n.getUTCDay();return 0===i?7:i}function eD(e,t){let r=eZ(e)?ek:eS,n=r.findIndex(e=>e<t),i=t-r[n];return{month:n+1,day:i}}function eC(e,t){return(e-t+7)%7+1}function eT(e,t=4,r=1){let{year:n,month:i,day:a}=e,s=a+(eZ(n)?ek:eS)[i-1],o=eC(ex(n,i,a),r),l=Math.floor((s-o+14-t)/7),d;return l<1?l=e2(d=n-1,t,r):l>e2(n,t,r)?(d=n+1,l=1):d=n,{weekYear:d,weekNumber:l,weekday:o,...e7(e)}}function eO(e,t=4,r=1){let{weekYear:n,weekNumber:i,weekday:a}=e,s=eC(ex(n,1,t),r),o=eX(n),l=7*i+a-s-7+t,d;l<1?l+=eX(d=n-1):l>o?(d=n+1,l-=eX(n)):d=n;let{month:c,day:u}=eD(d,l);return{year:d,month:c,day:u,...e7(e)}}function eR(e){let{year:t,month:r,day:n}=e,i=n+(eZ(t)?ek:eS)[r-1];return{year:t,ordinal:i,...e7(e)}}function eA(e){let{year:t,ordinal:r}=e,{month:n,day:i}=eD(t,r);return{year:t,month:n,day:i,...e7(e)}}function eM(e,t){if(!(!eJ(e.localWeekday)||!eJ(e.localWeekNumber)||!eJ(e.localWeekYear)))return{minDaysInFirstWeek:4,startOfWeek:1};if(!eJ(e.weekday)||!eJ(e.weekNumber)||!eJ(e.weekYear))throw new l("Cannot mix locale-based week fields with ISO-based week fields");return eJ(e.localWeekday)||(e.weekday=e.localWeekday),eJ(e.localWeekNumber)||(e.weekNumber=e.localWeekNumber),eJ(e.localWeekYear)||(e.weekYear=e.localWeekYear),delete e.localWeekday,delete e.localWeekNumber,delete e.localWeekYear,{minDaysInFirstWeek:t.getMinDaysInFirstWeek(),startOfWeek:t.getStartOfWeek()}}function eN(e){let t=eq(e.year),r=e$(e.month,1,12),n=e$(e.day,1,eQ(e.year,e.month));return t?r?!n&&ej("day",e.day):ej("month",e.month):ej("year",e.year)}function eP(e){let{hour:t,minute:r,second:n,millisecond:i}=e,a=e$(t,0,23)||24===t&&0===r&&0===n&&0===i,s=e$(r,0,59),o=e$(n,0,59),l=e$(i,0,999);return a?s?o?!l&&ej("millisecond",i):ej("second",n):ej("minute",r):ej("hour",t)}function eJ(e){return void 0===e}function eL(e){return"number"==typeof e}function eq(e){return"number"==typeof e&&e%1==0}function eF(){try{return"u">typeof Intl&&!!Intl.RelativeTimeFormat}catch(e){return!1}}function eV(){try{return"u">typeof Intl&&!!Intl.Locale&&("weekInfo"in Intl.Locale.prototype||"getWeekInfo"in Intl.Locale.prototype)}catch(e){return!1}}function e_(e,t,r){if(0!==e.length)return e.reduce((e,n)=>{let i=[t(n),n];return e&&r(e[0],i[0])===e[0]?e:i},null)[1]}function eG(e,t){return Object.prototype.hasOwnProperty.call(e,t)}function eY(e){if(null==e)return null;if("object"!=typeof e)throw new c("Week settings must be an object");if(!e$(e.firstDay,1,7)||!e$(e.minimalDays,1,7)||!Array.isArray(e.weekend)||e.weekend.some(e=>!e$(e,1,7)))throw new c("Invalid week settings");return{firstDay:e.firstDay,minimalDays:e.minimalDays,weekend:Array.from(e.weekend)}}function e$(e,t,r){return eq(e)&&e>=t&&e<=r}function eW(e,t=2){return e<0?"-"+(""+-e).padStart(t,"0"):(""+e).padStart(t,"0")}function eU(e){if(!eJ(e)&&null!==e&&""!==e)return parseInt(e,10)}function ez(e){if(!eJ(e)&&null!==e&&""!==e)return parseFloat(e)}function eH(e){if(!eJ(e)&&null!==e&&""!==e)return Math.floor(1e3*parseFloat("0."+e))}function eB(e,t,r="round"){let n=10**t;switch(r){case"expand":return e>0?Math.ceil(e*n)/n:Math.floor(e*n)/n;case"trunc":return Math.trunc(e*n)/n;case"round":return Math.round(e*n)/n;case"floor":return Math.floor(e*n)/n;case"ceil":return Math.ceil(e*n)/n;default:throw RangeError(`Value rounding ${r} is out of range`)}}function eZ(e){return e%4==0&&(e%100!=0||e%400==0)}function eX(e){return eZ(e)?366:365}function eQ(e,t){var r;let n=(r=t-1)-12*Math.floor(r/12)+1;return 2===n?eZ(e+(t-n)/12)?29:28:[31,null,31,30,31,30,31,31,30,31,30,31][n-1]}function e0(e){let t=Date.UTC(e.year,e.month-1,e.day,e.hour,e.minute,e.second,e.millisecond);return e.year<100&&e.year>=0&&(t=new Date(t)).setUTCFullYear(e.year,e.month-1,e.day),+t}function e1(e,t,r){return-eC(ex(e,1,t),r)+t-1}function e2(e,t=4,r=1){let n=e1(e,t,r),i=e1(e+1,t,r);return(eX(e)-n+i)/7}function e3(e){return e>99?e:e>eI.twoDigitCutoffYear?1900+e:2e3+e}function e4(e,t,r,n=null){let i=new Date(e),a={hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"};n&&(a.timeZone=n);let s={timeZoneName:t,...a},o=new Intl.DateTimeFormat(r,s).formatToParts(i).find(e=>"timezonename"===e.type.toLowerCase());return o?o.value:null}function e6(e,t){let r=parseInt(e,10);Number.isNaN(r)&&(r=0);let n=parseInt(t,10)||0,i=r<0||Object.is(r,-0)?-n:n;return 60*r+i}function e5(e){let t=Number(e);if("boolean"==typeof e||""===e||!Number.isFinite(t))throw new c(`Invalid unit value ${e}`);return t}function e8(e,t){let r={};for(let n in e)if(eG(e,n)){let i=e[n];if(null==i)continue;r[t(n)]=e5(i)}return r}function e9(e,t){let r=Math.trunc(Math.abs(e/60)),n=Math.trunc(Math.abs(e%60)),i=e>=0?"+":"-";switch(t){case"short":return`${i}${eW(r,2)}:${eW(n,2)}`;case"narrow":return`${i}${r}${n>0?`:${n}`:""}`;case"techie":return`${i}${eW(r,2)}${eW(n,2)}`;default:throw RangeError(`Value format ${t} is out of range for property format`)}}function e7(e){return["hour","minute","second","millisecond"].reduce((t,r)=>(t[r]=e[r],t),{})}let te=["January","February","March","April","May","June","July","August","September","October","November","December"],tt=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],tr=["J","F","M","A","M","J","J","A","S","O","N","D"];function tn(e){switch(e){case"narrow":return[...tr];case"short":return[...tt];case"long":return[...te];case"numeric":return["1","2","3","4","5","6","7","8","9","10","11","12"];case"2-digit":return["01","02","03","04","05","06","07","08","09","10","11","12"];default:return null}}let ti=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],ta=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],ts=["M","T","W","T","F","S","S"];function to(e){switch(e){case"narrow":return[...ts];case"short":return[...ta];case"long":return[...ti];case"numeric":return["1","2","3","4","5","6","7"];default:return null}}let tl=["AM","PM"],td=["Before Christ","Anno Domini"],tc=["BC","AD"],tu=["B","A"];function th(e){switch(e){case"narrow":return[...tu];case"short":return[...tc];case"long":return[...td];default:return null}}function tp(e,t){let r="";for(let n of e)n.literal?r+=n.val:r+=t(n.val);return r}let tm={D:y,DD:f,DDD:g,DDDD:K,t:v,tt:E,ttt:I,tttt:w,T:S,TT:k,TTT:j,TTTT:x,f:D,ff:T,fff:A,ffff:N,F:C,FF:O,FFF:M,FFFF:P};class ty{static create(e,t={}){return new ty(e,t)}static parseFormat(e){let t=null,r="",n=!1,i=[];for(let a=0;a<e.length;a++){let s=e.charAt(a);"'"===s?((r.length>0||n)&&i.push({literal:n||/^\s+$/.test(r),val:""===r?"'":r}),t=null,r="",n=!n):n||s===t?r+=s:(r.length>0&&i.push({literal:/^\s+$/.test(r),val:r}),r=s,t=s)}return r.length>0&&i.push({literal:n||/^\s+$/.test(r),val:r}),i}static macroTokenToFormatOpts(e){return tm[e]}constructor(e,t){this.opts=t,this.loc=e,this.systemLoc=null}formatWithSystemDefault(e,t){return null===this.systemLoc&&(this.systemLoc=this.loc.redefaultToSystem()),this.systemLoc.dtFormatter(e,{...this.opts,...t}).format()}dtFormatter(e,t={}){return this.loc.dtFormatter(e,{...this.opts,...t})}formatDateTime(e,t){return this.dtFormatter(e,t).format()}formatDateTimeParts(e,t){return this.dtFormatter(e,t).formatToParts()}formatInterval(e,t){return this.dtFormatter(e.start,t).dtf.formatRange(e.start.toJSDate(),e.end.toJSDate())}resolvedOptions(e,t){return this.dtFormatter(e,t).resolvedOptions()}num(e,t=0,r){if(this.opts.forceSimple)return eW(e,t);let n={...this.opts};return t>0&&(n.padTo=t),r&&(n.signDisplay=r),this.loc.numberFormatter(n).format(e)}formatDateTimeFromString(e,t){let r="en"===this.loc.listingMode(),n=this.loc.outputCalendar&&"gregory"!==this.loc.outputCalendar,i=(t,r)=>this.loc.extract(e,t,r),a=t=>e.isOffsetFixed&&0===e.offset&&t.allowZ?"Z":e.isValid?e.zone.formatOffset(e.ts,t.format):"",s=(t,n)=>r?tn(t)[e.month-1]:i(n?{month:t}:{month:t,day:"numeric"},"month"),o=(t,n)=>r?to(t)[e.weekday-1]:i(n?{weekday:t}:{weekday:t,month:"long",day:"numeric"},"weekday"),l=t=>{let r=ty.macroTokenToFormatOpts(t);return r?this.formatWithSystemDefault(e,r):t},d=t=>r?th(t)[e.year<0?0:1]:i({era:t},"era"),c=t=>{switch(t){case"S":return this.num(e.millisecond);case"u":case"SSS":return this.num(e.millisecond,3);case"s":return this.num(e.second);case"ss":return this.num(e.second,2);case"uu":return this.num(Math.floor(e.millisecond/10),2);case"uuu":return this.num(Math.floor(e.millisecond/100));case"m":return this.num(e.minute);case"mm":return this.num(e.minute,2);case"h":return this.num(e.hour%12==0?12:e.hour%12);case"hh":return this.num(e.hour%12==0?12:e.hour%12,2);case"H":return this.num(e.hour);case"HH":return this.num(e.hour,2);case"Z":return a({format:"narrow",allowZ:this.opts.allowZ});case"ZZ":return a({format:"short",allowZ:this.opts.allowZ});case"ZZZ":return a({format:"techie",allowZ:this.opts.allowZ});case"ZZZZ":return e.zone.offsetName(e.ts,{format:"short",locale:this.loc.locale});case"ZZZZZ":return e.zone.offsetName(e.ts,{format:"long",locale:this.loc.locale});case"z":return e.zoneName;case"a":return r?tl[e.hour<12?0:1]:i({hour:"numeric",hourCycle:"h12"},"dayperiod");case"d":return n?i({day:"numeric"},"day"):this.num(e.day);case"dd":return n?i({day:"2-digit"},"day"):this.num(e.day,2);case"c":case"E":return this.num(e.weekday);case"ccc":return o("short",!0);case"cccc":return o("long",!0);case"ccccc":return o("narrow",!0);case"EEE":return o("short",!1);case"EEEE":return o("long",!1);case"EEEEE":return o("narrow",!1);case"L":return n?i({month:"numeric",day:"numeric"},"month"):this.num(e.month);case"LL":return n?i({month:"2-digit",day:"numeric"},"month"):this.num(e.month,2);case"LLL":return s("short",!0);case"LLLL":return s("long",!0);case"LLLLL":return s("narrow",!0);case"M":return n?i({month:"numeric"},"month"):this.num(e.month);case"MM":return n?i({month:"2-digit"},"month"):this.num(e.month,2);case"MMM":return s("short",!1);case"MMMM":return s("long",!1);case"MMMMM":return s("narrow",!1);case"y":return n?i({year:"numeric"},"year"):this.num(e.year);case"yy":return n?i({year:"2-digit"},"year"):this.num(e.year.toString().slice(-2),2);case"yyyy":return n?i({year:"numeric"},"year"):this.num(e.year,4);case"yyyyyy":return n?i({year:"numeric"},"year"):this.num(e.year,6);case"G":return d("short");case"GG":return d("long");case"GGGGG":return d("narrow");case"kk":return this.num(e.weekYear.toString().slice(-2),2);case"kkkk":return this.num(e.weekYear,4);case"W":return this.num(e.weekNumber);case"WW":return this.num(e.weekNumber,2);case"n":return this.num(e.localWeekNumber);case"nn":return this.num(e.localWeekNumber,2);case"ii":return this.num(e.localWeekYear.toString().slice(-2),2);case"iiii":return this.num(e.localWeekYear,4);case"o":return this.num(e.ordinal);case"ooo":return this.num(e.ordinal,3);case"q":return this.num(e.quarter);case"qq":return this.num(e.quarter,2);case"X":return this.num(Math.floor(e.ts/1e3));case"x":return this.num(e.ts);default:return l(t)}};return tp(ty.parseFormat(t),c)}formatDurationFromString(e,t){let r="negativeLargestOnly"===this.opts.signMode?-1:1,n=e=>{switch(e[0]){case"S":return"milliseconds";case"s":return"seconds";case"m":return"minutes";case"h":return"hours";case"d":return"days";case"w":return"weeks";case"M":return"months";case"y":return"years";default:return null}},i=(e,t)=>i=>{let a=n(i);if(!a)return i;{let n,s=t.isNegativeDuration&&a!==t.largestUnit?r:1;return n="negativeLargestOnly"===this.opts.signMode&&a!==t.largestUnit?"never":"all"===this.opts.signMode?"always":"auto",this.num(e.get(a)*s,i.length,n)}},a=ty.parseFormat(t),s=a.reduce((e,{literal:t,val:r})=>t?e:e.concat(r),[]),o=e.shiftTo(...s.map(n).filter(e=>e)),l={isNegativeDuration:o<0,largestUnit:Object.keys(o.values)[0]};return tp(a,i(o,l))}}let tf=/[A-Za-z_+-]{1,256}(?::?\/[A-Za-z0-9_+-]{1,256}(?:\/[A-Za-z0-9_+-]{1,256})?)?/;function tb(...e){let t=e.reduce((e,t)=>e+t.source,"");return RegExp(`^${t}$`)}function tg(...e){return t=>e.reduce(([e,r,n],i)=>{let[a,s,o]=i(t,n);return[{...e,...a},s||r,o]},[{},null,1]).slice(0,2)}function tK(e,...t){if(null==e)return[null,null];for(let[r,n]of t){let t=r.exec(e);if(t)return n(t)}return[null,null]}function tv(...e){return(t,r)=>{let n,i={};for(n=0;n<e.length;n++)i[e[n]]=eU(t[r+n]);return[i,null,r+n]}}let tE=/(?:([Zz])|([+-]\d\d)(?::?(\d\d))?)/,tI=`(?:${tE.source}?(?:\\[(${tf.source})\\])?)?`,tw=/(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,30}))?)?)?/,tS=RegExp(`${tw.source}${tI}`),tk=RegExp(`(?:[Tt]${tS.source})?`),tj=tv("weekYear","weekNumber","weekDay"),tx=tv("year","ordinal"),tD=RegExp(`${tw.source} ?(?:${tE.source}|(${tf.source}))?`),tC=RegExp(`(?: ${tD.source})?`);function tT(e,t,r){let n=e[t];return eJ(n)?r:eU(n)}function tO(e,t){return[{hours:tT(e,t,0),minutes:tT(e,t+1,0),seconds:tT(e,t+2,0),milliseconds:eH(e[t+3])},null,t+4]}function tR(e,t){let r=!e[t]&&!e[t+1],n=e6(e[t+1],e[t+2]);return[{},r?null:es.instance(n),t+3]}function tA(e,t){return[{},e[t]?G.create(e[t]):null,t+1]}let tM=RegExp(`^T?${tw.source}$`),tN=/^-?P(?:(?:(-?\d{1,20}(?:\.\d{1,20})?)Y)?(?:(-?\d{1,20}(?:\.\d{1,20})?)M)?(?:(-?\d{1,20}(?:\.\d{1,20})?)W)?(?:(-?\d{1,20}(?:\.\d{1,20})?)D)?(?:T(?:(-?\d{1,20}(?:\.\d{1,20})?)H)?(?:(-?\d{1,20}(?:\.\d{1,20})?)M)?(?:(-?\d{1,20})(?:[.,](-?\d{1,20}))?S)?)?)$/;function tP(e){let[t,r,n,i,a,s,o,l,d]=e,c="-"===t[0],u=l&&"-"===l[0],h=(e,t=!1)=>void 0!==e&&(t||e&&c)?-e:e;return[{years:h(ez(r)),months:h(ez(n)),weeks:h(ez(i)),days:h(ez(a)),hours:h(ez(s)),minutes:h(ez(o)),seconds:h(ez(l),"-0"===l),milliseconds:h(eH(d),u)}]}let tJ={GMT:0,EDT:-240,EST:-300,CDT:-300,CST:-360,MDT:-360,MST:-420,PDT:-420,PST:-480};function tL(e,t,r,n,i,a,s){let o={year:2===t.length?e3(eU(t)):eU(t),month:tt.indexOf(r)+1,day:eU(n),hour:eU(i),minute:eU(a)};return s&&(o.second=eU(s)),e&&(o.weekday=e.length>3?ti.indexOf(e)+1:ta.indexOf(e)+1),o}let tq=/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|(?:([+-]\d\d)(\d\d)))$/;function tF(e){let[,t,r,n,i,a,s,o,l,d,c,u]=e;return[tL(t,i,n,r,a,s,o),new es(l?tJ[l]:d?0:e6(c,u))]}let tV=/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d\d):(\d\d):(\d\d) GMT$/,t_=/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d\d)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d\d) (\d\d):(\d\d):(\d\d) GMT$/,tG=/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d\d) (\d\d):(\d\d):(\d\d) (\d{4})$/;function tY(e){let[,t,r,n,i,a,s,o]=e;return[tL(t,i,n,r,a,s,o),es.utcInstance]}function t$(e){let[,t,r,n,i,a,s,o]=e;return[tL(t,o,r,n,i,a,s),es.utcInstance]}let tW=tb(/([+-]\d{6}|\d{4})(?:-?(\d\d)(?:-?(\d\d))?)?/,tk),tU=tb(/(\d{4})-?W(\d\d)(?:-?(\d))?/,tk),tz=tb(/(\d{4})-?(\d{3})/,tk),tH=tb(tS),tB=tg(function(e,t){return[{year:tT(e,t),month:tT(e,t+1,1),day:tT(e,t+2,1)},null,t+3]},tO,tR,tA),tZ=tg(tj,tO,tR,tA),tX=tg(tx,tO,tR,tA),tQ=tg(tO,tR,tA),t0=tg(tO),t1=tb(/(\d{4})-(\d\d)-(\d\d)/,tC),t2=tb(tD),t3=tg(tO,tR,tA),t4="Invalid Duration",t6={weeks:{days:7,hours:168,minutes:10080,seconds:604800,milliseconds:6048e5},days:{hours:24,minutes:1440,seconds:86400,milliseconds:864e5},hours:{minutes:60,seconds:3600,milliseconds:36e5},minutes:{seconds:60,milliseconds:6e4},seconds:{milliseconds:1e3}},t5={years:{quarters:4,months:12,weeks:52,days:365,hours:8760,minutes:525600,seconds:31536e3,milliseconds:31536e6},quarters:{months:3,weeks:13,days:91,hours:2184,minutes:131040,seconds:7862400,milliseconds:78624e5},months:{weeks:4,days:30,hours:720,minutes:43200,seconds:2592e3,milliseconds:2592e6},...t6},t8={years:{quarters:4,months:12,weeks:52.1775,days:365.2425,hours:8765.82,minutes:525949.2,seconds:0x1e18558,milliseconds:31556952e3},quarters:{months:3,weeks:13.044375,days:91.310625,hours:2191.455,minutes:131487.3,seconds:7889238,milliseconds:7889238e3},months:{weeks:30.436875/7,days:30.436875,hours:730.485,minutes:43829.1,seconds:2629746,milliseconds:2629746e3},...t6},t9=["years","quarters","months","weeks","days","hours","minutes","seconds","milliseconds"],t7=t9.slice(0).reverse();function re(e,t,r=!1){return new ri({values:r?t.values:{...e.values,...t.values||{}},loc:e.loc.clone(t.loc),conversionAccuracy:t.conversionAccuracy||e.conversionAccuracy,matrix:t.matrix||e.matrix})}function rt(e,t){var r;let n=null!=(r=t.milliseconds)?r:0;for(let r of t7.slice(1))t[r]&&(n+=t[r]*e[r].milliseconds);return n}function rr(e,t){let r=0>rt(e,t)?-1:1;t9.reduceRight((n,i)=>{if(eJ(t[i]))return n;if(n){let a=t[n]*r,s=e[i][n],o=Math.floor(a/s);t[i]+=o*r,t[n]-=o*s*r}return i},null),t9.reduce((r,n)=>{if(eJ(t[n]))return r;if(r){let i=t[r]%1;t[r]-=i,t[n]+=i*e[r][n]}return n},null)}function rn(e){let t={};for(let[r,n]of Object.entries(e))0!==n&&(t[r]=n);return t}class ri{constructor(e){const t="longterm"===e.conversionAccuracy;let r=t?t8:t5;e.matrix&&(r=e.matrix),this.values=e.values,this.loc=e.loc||ei.create(),this.conversionAccuracy=t?"longterm":"casual",this.invalid=e.invalid||null,this.matrix=r,this.isLuxonDuration=!0}static fromMillis(e,t){return ri.fromObject({milliseconds:e},t)}static fromObject(e,t={}){if(null==e||"object"!=typeof e)throw new c(`Duration.fromObject: argument expected to be an object, got ${null===e?"null":typeof e}`);return new ri({values:e8(e,ri.normalizeUnit),loc:ei.fromObject(t),conversionAccuracy:t.conversionAccuracy,matrix:t.matrix})}static fromDurationLike(e){if(eL(e))return ri.fromMillis(e);if(ri.isDuration(e))return e;if("object"==typeof e)return ri.fromObject(e);throw new c(`Unknown duration argument ${e} of type ${typeof e}`)}static fromISO(e,t){let[r]=tK(e,[tN,tP]);return r?ri.fromObject(r,t):ri.invalid("unparsable",`the input "${e}" can't be parsed as ISO 8601`)}static fromISOTime(e,t){let[r]=tK(e,[tM,t0]);return r?ri.fromObject(r,t):ri.invalid("unparsable",`the input "${e}" can't be parsed as ISO 8601`)}static invalid(e,t=null){if(!e)throw new c("need to specify a reason the Duration is invalid");let r=e instanceof ew?e:new ew(e,t);if(!eI.throwOnInvalid)return new ri({invalid:r});throw new o(r)}static normalizeUnit(e){let t={year:"years",years:"years",quarter:"quarters",quarters:"quarters",month:"months",months:"months",week:"weeks",weeks:"weeks",day:"days",days:"days",hour:"hours",hours:"hours",minute:"minutes",minutes:"minutes",second:"seconds",seconds:"seconds",millisecond:"milliseconds",milliseconds:"milliseconds"}[e?e.toLowerCase():e];if(!t)throw new d(e);return t}static isDuration(e){return e&&e.isLuxonDuration||!1}get locale(){return this.isValid?this.loc.locale:null}get numberingSystem(){return this.isValid?this.loc.numberingSystem:null}toFormat(e,t={}){let r={...t,floor:!1!==t.round&&!1!==t.floor};return this.isValid?ty.create(this.loc,r).formatDurationFromString(this,e):t4}toHuman(e={}){if(!this.isValid)return t4;let t=!1!==e.showZeros,r=t9.map(r=>{let n=this.values[r];return eJ(n)||0===n&&!t?null:this.loc.numberFormatter({style:"unit",unitDisplay:"long",...e,unit:r.slice(0,-1)}).format(n)}).filter(e=>e);return this.loc.listFormatter({type:"conjunction",style:e.listStyle||"narrow",...e}).format(r)}toObject(){return this.isValid?{...this.values}:{}}toISO(){if(!this.isValid)return null;let e="P";return 0!==this.years&&(e+=this.years+"Y"),(0!==this.months||0!==this.quarters)&&(e+=this.months+3*this.quarters+"M"),0!==this.weeks&&(e+=this.weeks+"W"),0!==this.days&&(e+=this.days+"D"),(0!==this.hours||0!==this.minutes||0!==this.seconds||0!==this.milliseconds)&&(e+="T"),0!==this.hours&&(e+=this.hours+"H"),0!==this.minutes&&(e+=this.minutes+"M"),(0!==this.seconds||0!==this.milliseconds)&&(e+=eB(this.seconds+this.milliseconds/1e3,3)+"S"),"P"===e&&(e+="T0S"),e}toISOTime(e={}){if(!this.isValid)return null;let t=this.toMillis();return t<0||t>=864e5?null:(e={suppressMilliseconds:!1,suppressSeconds:!1,includePrefix:!1,format:"extended",...e,includeOffset:!1},rz.fromMillis(t,{zone:"UTC"}).toISOTime(e))}toJSON(){return this.toISO()}toString(){return this.toISO()}[Symbol.for("nodejs.util.inspect.custom")](){return this.isValid?`Duration { values: ${JSON.stringify(this.values)} }`:`Duration { Invalid, reason: ${this.invalidReason} }`}toMillis(){return this.isValid?rt(this.matrix,this.values):NaN}valueOf(){return this.toMillis()}plus(e){if(!this.isValid)return this;let t=ri.fromDurationLike(e),r={};for(let e of t9)(eG(t.values,e)||eG(this.values,e))&&(r[e]=t.get(e)+this.get(e));return re(this,{values:r},!0)}minus(e){if(!this.isValid)return this;let t=ri.fromDurationLike(e);return this.plus(t.negate())}mapUnits(e){if(!this.isValid)return this;let t={};for(let r of Object.keys(this.values))t[r]=e5(e(this.values[r],r));return re(this,{values:t},!0)}get(e){return this[ri.normalizeUnit(e)]}set(e){return this.isValid?re(this,{values:{...this.values,...e8(e,ri.normalizeUnit)}}):this}reconfigure({locale:e,numberingSystem:t,conversionAccuracy:r,matrix:n}={}){return re(this,{loc:this.loc.clone({locale:e,numberingSystem:t}),matrix:n,conversionAccuracy:r})}as(e){return this.isValid?this.shiftTo(e).get(e):NaN}normalize(){if(!this.isValid)return this;let e=this.toObject();return rr(this.matrix,e),re(this,{values:e},!0)}rescale(){return this.isValid?re(this,{values:rn(this.normalize().shiftToAll().toObject())},!0):this}shiftTo(...e){let t;if(!this.isValid||0===e.length)return this;e=e.map(e=>ri.normalizeUnit(e));let r={},n={},i=this.toObject();for(let a of t9)if(e.indexOf(a)>=0){t=a;let e=0;for(let t in n)e+=this.matrix[t][a]*n[t],n[t]=0;eL(i[a])&&(e+=i[a]);let s=Math.trunc(e);r[a]=s,n[a]=(1e3*e-1e3*s)/1e3}else eL(i[a])&&(n[a]=i[a]);for(let e in n)0!==n[e]&&(r[t]+=e===t?n[e]:n[e]/this.matrix[t][e]);return rr(this.matrix,r),re(this,{values:r},!0)}shiftToAll(){return this.isValid?this.shiftTo("years","months","weeks","days","hours","minutes","seconds","milliseconds"):this}negate(){if(!this.isValid)return this;let e={};for(let t of Object.keys(this.values))e[t]=0===this.values[t]?0:-this.values[t];return re(this,{values:e},!0)}removeZeros(){return this.isValid?re(this,{values:rn(this.values)},!0):this}get years(){return this.isValid?this.values.years||0:NaN}get quarters(){return this.isValid?this.values.quarters||0:NaN}get months(){return this.isValid?this.values.months||0:NaN}get weeks(){return this.isValid?this.values.weeks||0:NaN}get days(){return this.isValid?this.values.days||0:NaN}get hours(){return this.isValid?this.values.hours||0:NaN}get minutes(){return this.isValid?this.values.minutes||0:NaN}get seconds(){return this.isValid?this.values.seconds||0:NaN}get milliseconds(){return this.isValid?this.values.milliseconds||0:NaN}get isValid(){return null===this.invalid}get invalidReason(){return this.invalid?this.invalid.reason:null}get invalidExplanation(){return this.invalid?this.invalid.explanation:null}equals(e){if(!this.isValid||!e.isValid||!this.loc.equals(e.loc))return!1;for(let n of t9){var t,r;if(t=this.values[n],r=e.values[n],void 0===t||0===t?void 0!==r&&0!==r:t!==r)return!1}return!0}}let ra="Invalid Interval";class rs{constructor(e){this.s=e.start,this.e=e.end,this.invalid=e.invalid||null,this.isLuxonInterval=!0}static invalid(e,t=null){if(!e)throw new c("need to specify a reason the Interval is invalid");let r=e instanceof ew?e:new ew(e,t);if(!eI.throwOnInvalid)return new rs({invalid:r});throw new s(r)}static fromDateTimes(e,t){var r,n;let i=rH(e),a=rH(t),s=(r=i,n=a,r&&r.isValid?n&&n.isValid?n<r?rs.invalid("end before start",`The end of an interval must be after its start, but you had start=${r.toISO()} and end=${n.toISO()}`):null:rs.invalid("missing or invalid end"):rs.invalid("missing or invalid start"));return null==s?new rs({start:i,end:a}):s}static after(e,t){let r=ri.fromDurationLike(t),n=rH(e);return rs.fromDateTimes(n,n.plus(r))}static before(e,t){let r=ri.fromDurationLike(t),n=rH(e);return rs.fromDateTimes(n.minus(r),n)}static fromISO(e,t){let[r,n]=(e||"").split("/",2);if(r&&n){let e,i,a,s;try{i=(e=rz.fromISO(r,t)).isValid}catch(e){i=!1}try{s=(a=rz.fromISO(n,t)).isValid}catch(e){s=!1}if(i&&s)return rs.fromDateTimes(e,a);if(i){let r=ri.fromISO(n,t);if(r.isValid)return rs.after(e,r)}else if(s){let e=ri.fromISO(r,t);if(e.isValid)return rs.before(a,e)}}return rs.invalid("unparsable",`the input "${e}" can't be parsed as ISO 8601`)}static isInterval(e){return e&&e.isLuxonInterval||!1}get start(){return this.isValid?this.s:null}get end(){return this.isValid?this.e:null}get lastDateTime(){return this.isValid&&this.e?this.e.minus(1):null}get isValid(){return null===this.invalidReason}get invalidReason(){return this.invalid?this.invalid.reason:null}get invalidExplanation(){return this.invalid?this.invalid.explanation:null}length(e="milliseconds"){return this.isValid?this.toDuration(e).get(e):NaN}count(e="milliseconds",t){let r;if(!this.isValid)return NaN;let n=this.start.startOf(e,t);return Math.floor((r=(r=null!=t&&t.useLocaleWeeks?this.end.reconfigure({locale:n.locale}):this.end).startOf(e,t)).diff(n,e).get(e))+(r.valueOf()!==this.end.valueOf())}hasSame(e){return!!this.isValid&&(this.isEmpty()||this.e.minus(1).hasSame(this.s,e))}isEmpty(){return this.s.valueOf()===this.e.valueOf()}isAfter(e){return!!this.isValid&&this.s>e}isBefore(e){return!!this.isValid&&this.e<=e}contains(e){return!!this.isValid&&this.s<=e&&this.e>e}set({start:e,end:t}={}){return this.isValid?rs.fromDateTimes(e||this.s,t||this.e):this}splitAt(...e){if(!this.isValid)return[];let t=e.map(rH).filter(e=>this.contains(e)).sort((e,t)=>e.toMillis()-t.toMillis()),r=[],{s:n}=this,i=0;for(;n<this.e;){let e=t[i]||this.e,a=+e>+this.e?this.e:e;r.push(rs.fromDateTimes(n,a)),n=a,i+=1}return r}splitBy(e){let t=ri.fromDurationLike(e);if(!this.isValid||!t.isValid||0===t.as("milliseconds"))return[];let{s:r}=this,n=1,i,a=[];for(;r<this.e;){let e=this.start.plus(t.mapUnits(e=>e*n));i=+e>+this.e?this.e:e,a.push(rs.fromDateTimes(r,i)),r=i,n+=1}return a}divideEqually(e){return this.isValid?this.splitBy(this.length()/e).slice(0,e):[]}overlaps(e){return this.e>e.s&&this.s<e.e}abutsStart(e){return!!this.isValid&&+this.e==+e.s}abutsEnd(e){return!!this.isValid&&+e.e==+this.s}engulfs(e){return!!this.isValid&&this.s<=e.s&&this.e>=e.e}equals(e){return!!this.isValid&&!!e.isValid&&this.s.equals(e.s)&&this.e.equals(e.e)}intersection(e){if(!this.isValid)return this;let t=this.s>e.s?this.s:e.s,r=this.e<e.e?this.e:e.e;return t>=r?null:rs.fromDateTimes(t,r)}union(e){if(!this.isValid)return this;let t=this.s<e.s?this.s:e.s,r=this.e>e.e?this.e:e.e;return rs.fromDateTimes(t,r)}static merge(e){let[t,r]=e.sort((e,t)=>e.s-t.s).reduce(([e,t],r)=>t?t.overlaps(r)||t.abutsStart(r)?[e,t.union(r)]:[e.concat([t]),r]:[e,r],[[],null]);return r&&t.push(r),t}static xor(e){let t=null,r=0,n=[],i=e.map(e=>[{time:e.s,type:"s"},{time:e.e,type:"e"}]);for(let e of Array.prototype.concat(...i).sort((e,t)=>e.time-t.time))1===(r+="s"===e.type?1:-1)?t=e.time:(t&&+t!=+e.time&&n.push(rs.fromDateTimes(t,e.time)),t=null);return rs.merge(n)}difference(...e){return rs.xor([this].concat(e)).map(e=>this.intersection(e)).filter(e=>e&&!e.isEmpty())}toString(){return this.isValid?`[${this.s.toISO()} – ${this.e.toISO()})`:ra}[Symbol.for("nodejs.util.inspect.custom")](){return this.isValid?`Interval { start: ${this.s.toISO()}, end: ${this.e.toISO()} }`:`Interval { Invalid, reason: ${this.invalidReason} }`}toLocaleString(e=y,t={}){return this.isValid?ty.create(this.s.loc.clone(t),e).formatInterval(this):ra}toISO(e){return this.isValid?`${this.s.toISO(e)}/${this.e.toISO(e)}`:ra}toISODate(){return this.isValid?`${this.s.toISODate()}/${this.e.toISODate()}`:ra}toISOTime(e){return this.isValid?`${this.s.toISOTime(e)}/${this.e.toISOTime(e)}`:ra}toFormat(e,{separator:t=" – "}={}){return this.isValid?`${this.s.toFormat(e)}${t}${this.e.toFormat(e)}`:ra}toDuration(e,t){return this.isValid?this.e.diff(this.s,e,t):ri.invalid(this.invalidReason)}mapEndpoints(e){return rs.fromDateTimes(e(this.s),e(this.e))}}class ro{static hasDST(e=eI.defaultZone){let t=rz.now().setZone(e).set({month:12});return!e.isUniversal&&t.offset!==t.set({month:6}).offset}static isValidIANAZone(e){return G.isValidZone(e)}static normalizeZone(e){return el(e,eI.defaultZone)}static getStartOfWeek({locale:e=null,locObj:t=null}={}){return(t||ei.create(e)).getStartOfWeek()}static getMinimumDaysInFirstWeek({locale:e=null,locObj:t=null}={}){return(t||ei.create(e)).getMinDaysInFirstWeek()}static getWeekendWeekdays({locale:e=null,locObj:t=null}={}){return(t||ei.create(e)).getWeekendDays().slice()}static months(e="long",{locale:t=null,numberingSystem:r=null,locObj:n=null,outputCalendar:i="gregory"}={}){return(n||ei.create(t,r,i)).months(e)}static monthsFormat(e="long",{locale:t=null,numberingSystem:r=null,locObj:n=null,outputCalendar:i="gregory"}={}){return(n||ei.create(t,r,i)).months(e,!0)}static weekdays(e="long",{locale:t=null,numberingSystem:r=null,locObj:n=null}={}){return(n||ei.create(t,r,null)).weekdays(e)}static weekdaysFormat(e="long",{locale:t=null,numberingSystem:r=null,locObj:n=null}={}){return(n||ei.create(t,r,null)).weekdays(e,!0)}static meridiems({locale:e=null}={}){return ei.create(e).meridiems()}static eras(e="short",{locale:t=null}={}){return ei.create(t,null,"gregory").eras(e)}static features(){return{relative:eF(),localeWeek:eV()}}}function rl(e,t){let r=e=>e.toUTC(0,{keepLocalTime:!0}).startOf("day").valueOf(),n=r(t)-r(e);return Math.floor(ri.fromMillis(n).as("days"))}function rd(e,t=e=>e){return{regex:e,deser:([e])=>t(function(e){let t=parseInt(e,10);if(!isNaN(t))return t;t="";for(let r=0;r<e.length;r++){let n=e.charCodeAt(r);if(-1!==e[r].search(ed.hanidec))t+=eu.indexOf(e[r]);else for(let e in ec){let[r,i]=ec[e];n>=r&&n<=i&&(t+=n-r)}}return parseInt(t,10)}(e))}}let rc=String.fromCharCode(160),ru=`[ ${rc}]`,rh=RegExp(ru,"g");function rp(e){return e.replace(/\./g,"\\.?").replace(rh,ru)}function rm(e){return e.replace(/\./g,"").replace(rh," ").toLowerCase()}function ry(e,t){return null===e?null:{regex:RegExp(e.map(rp).join("|")),deser:([r])=>e.findIndex(e=>rm(r)===rm(e))+t}}function rf(e,t){return{regex:e,deser:([,e,t])=>e6(e,t),groups:t}}function rb(e){return{regex:e,deser:([e])=>e}}let rg={year:{"2-digit":"yy",numeric:"yyyyy"},month:{numeric:"M","2-digit":"MM",short:"MMM",long:"MMMM"},day:{numeric:"d","2-digit":"dd"},weekday:{short:"EEE",long:"EEEE"},dayperiod:"a",dayPeriod:"a",hour12:{numeric:"h","2-digit":"hh"},hour24:{numeric:"H","2-digit":"HH"},minute:{numeric:"m","2-digit":"mm"},second:{numeric:"s","2-digit":"ss"},timeZoneName:{long:"ZZZZZ",short:"ZZZ"}},rK=null;function rv(e,t){return Array.prototype.concat(...e.map(e=>(function(e,t){if(e.literal)return e;let r=rw(ty.macroTokenToFormatOpts(e.val),t);return null==r||r.includes(void 0)?e:r})(e,t)))}class rE{constructor(e,t){if(this.locale=e,this.format=t,this.tokens=rv(ty.parseFormat(t),e),this.units=this.tokens.map(t=>{let r,n,i,a,s,o,l,d,c,u,h,p,m;return r=ep(e),n=ep(e,"{2}"),i=ep(e,"{3}"),a=ep(e,"{4}"),s=ep(e,"{6}"),o=ep(e,"{1,2}"),l=ep(e,"{1,3}"),d=ep(e,"{1,6}"),c=ep(e,"{1,9}"),u=ep(e,"{2,4}"),h=ep(e,"{4,6}"),p=e=>({regex:RegExp(e.val.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g,"\\$&")),deser:([e])=>e,literal:!0}),(m=(m=>{if(t.literal)return p(m);switch(m.val){case"G":return ry(e.eras("short"),0);case"GG":return ry(e.eras("long"),0);case"y":return rd(d);case"yy":case"kk":return rd(u,e3);case"yyyy":case"kkkk":return rd(a);case"yyyyy":return rd(h);case"yyyyyy":return rd(s);case"M":case"L":case"d":case"H":case"h":case"m":case"q":case"s":case"W":return rd(o);case"MM":case"LL":case"dd":case"HH":case"hh":case"mm":case"qq":case"ss":case"WW":return rd(n);case"MMM":return ry(e.months("short",!0),1);case"MMMM":return ry(e.months("long",!0),1);case"LLL":return ry(e.months("short",!1),1);case"LLLL":return ry(e.months("long",!1),1);case"o":case"S":return rd(l);case"ooo":case"SSS":return rd(i);case"u":return rb(c);case"uu":return rb(o);case"uuu":case"E":case"c":return rd(r);case"a":return ry(e.meridiems(),0);case"EEE":return ry(e.weekdays("short",!1),1);case"EEEE":return ry(e.weekdays("long",!1),1);case"ccc":return ry(e.weekdays("short",!0),1);case"cccc":return ry(e.weekdays("long",!0),1);case"Z":case"ZZ":return rf(RegExp(`([+-]${o.source})(?::(${n.source}))?`),2);case"ZZZ":return rf(RegExp(`([+-]${o.source})(${n.source})?`),2);case"z":return rb(/[a-z_+-/]{1,256}?/i);case" ":return rb(/[^\S\n\r]/);default:return p(m)}})(t)||{invalidReason:"missing Intl.DateTimeFormat.formatToParts support"}).token=t,m}),this.disqualifyingUnit=this.units.find(e=>e.invalidReason),!this.disqualifyingUnit){const[e,t]=function(e){let t=e.map(e=>e.regex).reduce((e,t)=>`${e}(${t.source})`,"");return[`^${t}$`,e]}(this.units);this.regex=RegExp(e,"i"),this.handlers=t}}explainFromTokens(e){if(!this.isValid)return{input:e,tokens:this.tokens,invalidReason:this.invalidReason};{let t,r,[n,i]=function(e,t,r){let n=e.match(t);if(!n)return[n,{}];{let e={},t=1;for(let i in r)if(eG(r,i)){let a=r[i],s=a.groups?a.groups+1:1;!a.literal&&a.token&&(e[a.token.val[0]]=a.deser(n.slice(t,t+s))),t+=s}return[n,e]}}(e,this.regex,this.handlers),[a,s,o]=i?(r=null,eJ(i.z)||(r=G.create(i.z)),eJ(i.Z)||(r||(r=new es(i.Z)),t=i.Z),eJ(i.q)||(i.M=(i.q-1)*3+1),eJ(i.h)||(i.h<12&&1===i.a?i.h+=12:12===i.h&&0===i.a&&(i.h=0)),0===i.G&&i.y&&(i.y=-i.y),eJ(i.u)||(i.S=eH(i.u)),[Object.keys(i).reduce((e,t)=>{let r=(e=>{switch(e){case"S":return"millisecond";case"s":return"second";case"m":return"minute";case"h":case"H":return"hour";case"d":return"day";case"o":return"ordinal";case"L":case"M":return"month";case"y":return"year";case"E":case"c":return"weekday";case"W":return"weekNumber";case"k":return"weekYear";case"q":return"quarter";default:return null}})(t);return r&&(e[r]=i[t]),e},{}),r,t]):[null,null,void 0];if(eG(i,"a")&&eG(i,"H"))throw new l("Can't include meridiem when specifying 24-hour format");return{input:e,tokens:this.tokens,regex:this.regex,rawMatches:n,matches:i,result:a,zone:s,specificOffset:o}}}get isValid(){return!this.disqualifyingUnit}get invalidReason(){return this.disqualifyingUnit?this.disqualifyingUnit.invalidReason:null}}function rI(e,t,r){return new rE(e,r).explainFromTokens(t)}function rw(e,t){if(!e)return null;let r=ty.create(t,e).dtFormatter((rK||(rK=rz.fromMillis(0x16a2e5618e3)),rK)),n=r.formatToParts(),i=r.resolvedOptions();return n.map(t=>(function(e,t,r){let{type:n,value:i}=e;if("literal"===n){let e=/^\s+$/.test(i);return{literal:!e,val:e?" ":i}}let a=t[n],s=n;"hour"===n&&(s=null!=t.hour12?t.hour12?"hour12":"hour24":null!=t.hourCycle?"h11"===t.hourCycle||"h12"===t.hourCycle?"hour12":"hour24":r.hour12?"hour12":"hour24");let o=rg[s];if("object"==typeof o&&(o=o[a]),o)return{literal:!1,val:o}})(t,e,i))}let rS="Invalid DateTime";function rk(e){return new ew("unsupported zone",`the zone "${e.name}" is not supported`)}function rj(e){return null===e.weekData&&(e.weekData=eT(e.c)),e.weekData}function rx(e){return null===e.localWeekData&&(e.localWeekData=eT(e.c,e.loc.getMinDaysInFirstWeek(),e.loc.getStartOfWeek())),e.localWeekData}function rD(e,t){let r={ts:e.ts,zone:e.zone,c:e.c,o:e.o,loc:e.loc,invalid:e.invalid};return new rz({...r,...t,old:r})}function rC(e,t,r){let n=e-60*t*1e3,i=r.offset(n);if(t===i)return[n,t];n-=(i-t)*6e4;let a=r.offset(n);return i===a?[n,i]:[e-60*Math.min(i,a)*1e3,Math.max(i,a)]}function rT(e,t){let r=new Date(e+=60*t*1e3);return{year:r.getUTCFullYear(),month:r.getUTCMonth()+1,day:r.getUTCDate(),hour:r.getUTCHours(),minute:r.getUTCMinutes(),second:r.getUTCSeconds(),millisecond:r.getUTCMilliseconds()}}function rO(e,t){let r=e.o,n=e.c.year+Math.trunc(t.years),i=e.c.month+Math.trunc(t.months)+3*Math.trunc(t.quarters),a={...e.c,year:n,month:i,day:Math.min(e.c.day,eQ(n,i))+Math.trunc(t.days)+7*Math.trunc(t.weeks)},s=ri.fromObject({years:t.years-Math.trunc(t.years),quarters:t.quarters-Math.trunc(t.quarters),months:t.months-Math.trunc(t.months),weeks:t.weeks-Math.trunc(t.weeks),days:t.days-Math.trunc(t.days),hours:t.hours,minutes:t.minutes,seconds:t.seconds,milliseconds:t.milliseconds}).as("milliseconds"),[o,l]=rC(e0(a),r,e.zone);return 0!==s&&(o+=s,l=e.zone.offset(o)),{ts:o,o:l}}function rR(e,t,r,n,i,a){let{setZone:s,zone:o}=r;if((!e||0===Object.keys(e).length)&&!t)return rz.invalid(new ew("unparsable",`the input "${i}" can't be parsed as ${n}`));{let n=rz.fromObject(e,{...r,zone:t||o,specificOffset:a});return s?n:n.setZone(o)}}function rA(e,t,r=!0){return e.isValid?ty.create(ei.create("en-US"),{allowZ:r,forceSimple:!0}).formatDateTimeFromString(e,t):null}function rM(e,t,r){let n=e.c.year>9999||e.c.year<0,i="";if(n&&e.c.year>=0&&(i+="+"),i+=eW(e.c.year,n?6:4),"year"===r)return i;if(t){if(i+="-",i+=eW(e.c.month),"month"===r)return i;i+="-"}else if(i+=eW(e.c.month),"month"===r)return i;return i+eW(e.c.day)}function rN(e,t,r,n,i,a,s){let o=!r||0!==e.c.millisecond||0!==e.c.second,l="";switch(s){case"day":case"month":case"year":break;default:if(l+=eW(e.c.hour),"hour"===s)break;if(t){if(l+=":",l+=eW(e.c.minute),"minute"===s)break;o&&(l+=":",l+=eW(e.c.second))}else{if(l+=eW(e.c.minute),"minute"===s)break;o&&(l+=eW(e.c.second))}if("second"===s)break;o&&(!n||0!==e.c.millisecond)&&(l+=".",l+=eW(e.c.millisecond,3))}return i&&(e.isOffsetFixed&&0===e.offset&&!a?l+="Z":e.o<0?(l+="-",l+=eW(Math.trunc(-e.o/60)),l+=":",l+=eW(Math.trunc(-e.o%60))):(l+="+",l+=eW(Math.trunc(e.o/60)),l+=":",l+=eW(Math.trunc(e.o%60)))),a&&(l+="["+e.zone.ianaName+"]"),l}let rP={month:1,day:1,hour:0,minute:0,second:0,millisecond:0},rJ={weekNumber:1,weekday:1,hour:0,minute:0,second:0,millisecond:0},rL={ordinal:1,hour:0,minute:0,second:0,millisecond:0},rq=["year","month","day","hour","minute","second","millisecond"],rF=["weekYear","weekNumber","weekday","hour","minute","second","millisecond"],rV=["year","ordinal","hour","minute","second","millisecond"];function r_(e){let t={year:"year",years:"year",month:"month",months:"month",day:"day",days:"day",hour:"hour",hours:"hour",minute:"minute",minutes:"minute",quarter:"quarter",quarters:"quarter",second:"second",seconds:"second",millisecond:"millisecond",milliseconds:"millisecond",weekday:"weekday",weekdays:"weekday",weeknumber:"weekNumber",weeksnumber:"weekNumber",weeknumbers:"weekNumber",weekyear:"weekYear",weekyears:"weekYear",ordinal:"ordinal"}[e.toLowerCase()];if(!t)throw new d(e);return t}function rG(e){switch(e.toLowerCase()){case"localweekday":case"localweekdays":return"localWeekday";case"localweeknumber":case"localweeknumbers":return"localWeekNumber";case"localweekyear":case"localweekyears":return"localWeekYear";default:return r_(e)}}function rY(e,t){let r,i,a=el(t.zone,eI.defaultZone);if(!a.isValid)return rz.invalid(rk(a));let s=ei.fromObject(t);if(eJ(e.year))r=eI.now();else{for(let t of rq)eJ(e[t])&&(e[t]=rP[t]);let t=eN(e)||eP(e);if(t)return rz.invalid(t);let s=function(e){if(void 0===n&&(n=eI.now()),"iana"!==e.type)return e.offset(n);let t=e.name,r=rU.get(t);return void 0===r&&(r=e.offset(n),rU.set(t,r)),r}(a);[r,i]=rC(e0(e),s,a)}return new rz({ts:r,zone:a,loc:s,o:i})}function r$(e,t,r){let n=!!eJ(r.round)||r.round,i=eJ(r.rounding)?"trunc":r.rounding,a=(e,a)=>(e=eB(e,n||r.calendary?0:2,r.calendary?"round":i),t.loc.clone(r).relFormatter(r).format(e,a)),s=n=>r.calendary?t.hasSame(e,n)?0:t.startOf(n).diff(e.startOf(n),n).get(n):t.diff(e,n).get(n);if(r.unit)return a(s(r.unit),r.unit);for(let e of r.units){let t=s(e);if(Math.abs(t)>=1)return a(t,e)}return a(e>t?-0:0,r.units[r.units.length-1])}function rW(e){let t={},r;return e.length>0&&"object"==typeof e[e.length-1]?(t=e[e.length-1],r=Array.from(e).slice(0,e.length-1)):r=Array.from(e),[t,r]}let rU=new Map;class rz{constructor(e){const t=e.zone||eI.defaultZone;let r=e.invalid||(Number.isNaN(e.ts)?new ew("invalid input"):null)||(t.isValid?null:rk(t));this.ts=eJ(e.ts)?eI.now():e.ts;let n=null,i=null;if(!r)if(e.old&&e.old.ts===this.ts&&e.old.zone.equals(t))[n,i]=[e.old.c,e.old.o];else{const a=eL(e.o)&&!e.old?e.o:t.offset(this.ts);n=(r=Number.isNaN((n=rT(this.ts,a)).year)?new ew("invalid input"):null)?null:n,i=r?null:a}this._zone=t,this.loc=e.loc||ei.create(),this.invalid=r,this.weekData=null,this.localWeekData=null,this.c=n,this.o=i,this.isLuxonDateTime=!0}static now(){return new rz({})}static local(){let[e,t]=rW(arguments),[r,n,i,a,s,o,l]=t;return rY({year:r,month:n,day:i,hour:a,minute:s,second:o,millisecond:l},e)}static utc(){let[e,t]=rW(arguments),[r,n,i,a,s,o,l]=t;return e.zone=es.utcInstance,rY({year:r,month:n,day:i,hour:a,minute:s,second:o,millisecond:l},e)}static fromJSDate(e,t={}){let r="[object Date]"===Object.prototype.toString.call(e)?e.valueOf():NaN;if(Number.isNaN(r))return rz.invalid("invalid input");let n=el(t.zone,eI.defaultZone);return n.isValid?new rz({ts:r,zone:n,loc:ei.fromObject(t)}):rz.invalid(rk(n))}static fromMillis(e,t={}){if(eL(e))if(e<-864e13||e>864e13)return rz.invalid("Timestamp out of range");else return new rz({ts:e,zone:el(t.zone,eI.defaultZone),loc:ei.fromObject(t)});throw new c(`fromMillis requires a numerical input, but received a ${typeof e} with value ${e}`)}static fromSeconds(e,t={}){if(eL(e))return new rz({ts:1e3*e,zone:el(t.zone,eI.defaultZone),loc:ei.fromObject(t)});throw new c("fromSeconds requires a numerical input")}static fromObject(e,t={}){var r;let n,i;e=e||{};let a=el(t.zone,eI.defaultZone);if(!a.isValid)return rz.invalid(rk(a));let s=ei.fromObject(t),o=e8(e,rG),{minDaysInFirstWeek:d,startOfWeek:c}=eM(o,s),u=eI.now(),h=eJ(t.specificOffset)?a.offset(u):t.specificOffset,p=!eJ(o.ordinal),m=!eJ(o.year),y=!eJ(o.month)||!eJ(o.day),f=m||y,b=o.weekYear||o.weekNumber;if((f||p)&&b)throw new l("Can't mix weekYear/weekNumber units with year/month/day or ordinals");if(y&&p)throw new l("Can't mix ordinal dates with month/day");let g=b||o.weekday&&!f,K,v,E=rT(u,h);g?(K=rF,v=rJ,E=eT(E,d,c)):p?(K=rV,v=rL,E=eR(E)):(K=rq,v=rP);let I=!1;for(let e of K)eJ(o[e])?I?o[e]=v[e]:o[e]=E[e]:I=!0;let w=(g?function(e,t=4,r=1){let n=eq(e.weekYear),i=e$(e.weekNumber,1,e2(e.weekYear,t,r)),a=e$(e.weekday,1,7);return n?i?!a&&ej("weekday",e.weekday):ej("week",e.weekNumber):ej("weekYear",e.weekYear)}(o,d,c):p?(n=eq(o.year),i=e$(o.ordinal,1,eX(o.year)),n?!i&&ej("ordinal",o.ordinal):ej("year",o.year)):eN(o))||eP(o);if(w)return rz.invalid(w);let[S,k]=(r=g?eO(o,d,c):p?eA(o):o,rC(e0(r),h,a)),j=new rz({ts:S,zone:a,o:k,loc:s});return o.weekday&&f&&e.weekday!==j.weekday?rz.invalid("mismatched weekday",`you can't specify both a weekday of ${o.weekday} and a date of ${j.toISO()}`):j.isValid?j:rz.invalid(j.invalid)}static fromISO(e,t={}){let[r,n]=tK(e,[tW,tB],[tU,tZ],[tz,tX],[tH,tQ]);return rR(r,n,t,"ISO 8601",e)}static fromRFC2822(e,t={}){let[r,n]=tK(e.replace(/\([^()]*\)|[\n\t]/g," ").replace(/(\s\s+)/g," ").trim(),[tq,tF]);return rR(r,n,t,"RFC 2822",e)}static fromHTTP(e,t={}){let[r,n]=tK(e,[tV,tY],[t_,tY],[tG,t$]);return rR(r,n,t,"HTTP",t)}static fromFormat(e,t,r={}){if(eJ(e)||eJ(t))throw new c("fromFormat requires an input string and a format");let{locale:n=null,numberingSystem:i=null}=r,[a,s,o,l]=function(e,t,r){let{result:n,zone:i,specificOffset:a,invalidReason:s}=rI(e,t,r);return[n,i,a,s]}(ei.fromOpts({locale:n,numberingSystem:i,defaultToEN:!0}),e,t);return l?rz.invalid(l):rR(a,s,r,`format ${t}`,e,o)}static fromString(e,t,r={}){return rz.fromFormat(e,t,r)}static fromSQL(e,t={}){let[r,n]=tK(e,[t1,tB],[t2,t3]);return rR(r,n,t,"SQL",e)}static invalid(e,t=null){if(!e)throw new c("need to specify a reason the DateTime is invalid");let r=e instanceof ew?e:new ew(e,t);if(!eI.throwOnInvalid)return new rz({invalid:r});throw new a(r)}static isDateTime(e){return e&&e.isLuxonDateTime||!1}static parseFormatForOpts(e,t={}){let r=rw(e,ei.fromObject(t));return r?r.map(e=>e?e.val:null).join(""):null}static expandFormat(e,t={}){return rv(ty.parseFormat(e),ei.fromObject(t)).map(e=>e.val).join("")}static resetCache(){n=void 0,rU.clear()}get(e){return this[e]}get isValid(){return null===this.invalid}get invalidReason(){return this.invalid?this.invalid.reason:null}get invalidExplanation(){return this.invalid?this.invalid.explanation:null}get locale(){return this.isValid?this.loc.locale:null}get numberingSystem(){return this.isValid?this.loc.numberingSystem:null}get outputCalendar(){return this.isValid?this.loc.outputCalendar:null}get zone(){return this._zone}get zoneName(){return this.isValid?this.zone.name:null}get year(){return this.isValid?this.c.year:NaN}get quarter(){return this.isValid?Math.ceil(this.c.month/3):NaN}get month(){return this.isValid?this.c.month:NaN}get day(){return this.isValid?this.c.day:NaN}get hour(){return this.isValid?this.c.hour:NaN}get minute(){return this.isValid?this.c.minute:NaN}get second(){return this.isValid?this.c.second:NaN}get millisecond(){return this.isValid?this.c.millisecond:NaN}get weekYear(){return this.isValid?rj(this).weekYear:NaN}get weekNumber(){return this.isValid?rj(this).weekNumber:NaN}get weekday(){return this.isValid?rj(this).weekday:NaN}get isWeekend(){return this.isValid&&this.loc.getWeekendDays().includes(this.weekday)}get localWeekday(){return this.isValid?rx(this).weekday:NaN}get localWeekNumber(){return this.isValid?rx(this).weekNumber:NaN}get localWeekYear(){return this.isValid?rx(this).weekYear:NaN}get ordinal(){return this.isValid?eR(this.c).ordinal:NaN}get monthShort(){return this.isValid?ro.months("short",{locObj:this.loc})[this.month-1]:null}get monthLong(){return this.isValid?ro.months("long",{locObj:this.loc})[this.month-1]:null}get weekdayShort(){return this.isValid?ro.weekdays("short",{locObj:this.loc})[this.weekday-1]:null}get weekdayLong(){return this.isValid?ro.weekdays("long",{locObj:this.loc})[this.weekday-1]:null}get offset(){return this.isValid?+this.o:NaN}get offsetNameShort(){return this.isValid?this.zone.offsetName(this.ts,{format:"short",locale:this.locale}):null}get offsetNameLong(){return this.isValid?this.zone.offsetName(this.ts,{format:"long",locale:this.locale}):null}get isOffsetFixed(){return this.isValid?this.zone.isUniversal:null}get isInDST(){return!this.isOffsetFixed&&(this.offset>this.set({month:1,day:1}).offset||this.offset>this.set({month:5}).offset)}getPossibleOffsets(){if(!this.isValid||this.isOffsetFixed)return[this];let e=e0(this.c),t=this.zone.offset(e-864e5),r=this.zone.offset(e+864e5),n=this.zone.offset(e-6e4*t),i=this.zone.offset(e-6e4*r);if(n===i)return[this];let a=e-6e4*n,s=e-6e4*i,o=rT(a,n),l=rT(s,i);return o.hour===l.hour&&o.minute===l.minute&&o.second===l.second&&o.millisecond===l.millisecond?[rD(this,{ts:a}),rD(this,{ts:s})]:[this]}get isInLeapYear(){return eZ(this.year)}get daysInMonth(){return eQ(this.year,this.month)}get daysInYear(){return this.isValid?eX(this.year):NaN}get weeksInWeekYear(){return this.isValid?e2(this.weekYear):NaN}get weeksInLocalWeekYear(){return this.isValid?e2(this.localWeekYear,this.loc.getMinDaysInFirstWeek(),this.loc.getStartOfWeek()):NaN}resolvedLocaleOptions(e={}){let{locale:t,numberingSystem:r,calendar:n}=ty.create(this.loc.clone(e),e).resolvedOptions(this);return{locale:t,numberingSystem:r,outputCalendar:n}}toUTC(e=0,t={}){return this.setZone(es.instance(e),t)}toLocal(){return this.setZone(eI.defaultZone)}setZone(e,{keepLocalTime:t=!1,keepCalendarTime:r=!1}={}){if((e=el(e,eI.defaultZone)).equals(this.zone))return this;{if(!e.isValid)return rz.invalid(rk(e));let i=this.ts;if(t||r){var n;let t=e.offset(this.ts),r=this.toObject();[i]=(n=e,rC(e0(r),t,n))}return rD(this,{ts:i,zone:e})}}reconfigure({locale:e,numberingSystem:t,outputCalendar:r}={}){return rD(this,{loc:this.loc.clone({locale:e,numberingSystem:t,outputCalendar:r})})}setLocale(e){return this.reconfigure({locale:e})}set(e){var t,r,n;let i;if(!this.isValid)return this;let a=e8(e,rG),{minDaysInFirstWeek:s,startOfWeek:o}=eM(a,this.loc),d=!eJ(a.weekYear)||!eJ(a.weekNumber)||!eJ(a.weekday),c=!eJ(a.ordinal),u=!eJ(a.year),h=!eJ(a.month)||!eJ(a.day),p=a.weekYear||a.weekNumber;if((u||h||c)&&p)throw new l("Can't mix weekYear/weekNumber units with year/month/day or ordinals");if(h&&c)throw new l("Can't mix ordinal dates with month/day");d?i=eO({...eT(this.c,s,o),...a},s,o):eJ(a.ordinal)?(i={...this.toObject(),...a},eJ(a.day)&&(i.day=Math.min(eQ(i.year,i.month),i.day))):i=eA({...eR(this.c),...a});let[m,y]=(t=i,r=this.o,n=this.zone,rC(e0(t),r,n));return rD(this,{ts:m,o:y})}plus(e){return this.isValid?rD(this,rO(this,ri.fromDurationLike(e))):this}minus(e){return this.isValid?rD(this,rO(this,ri.fromDurationLike(e).negate())):this}startOf(e,{useLocaleWeeks:t=!1}={}){if(!this.isValid)return this;let r={},n=ri.normalizeUnit(e);switch(n){case"years":r.month=1;case"quarters":case"months":r.day=1;case"weeks":case"days":r.hour=0;case"hours":r.minute=0;case"minutes":r.second=0;case"seconds":r.millisecond=0}if("weeks"===n)if(t){let e=this.loc.getStartOfWeek(),{weekday:t}=this;t<e&&(r.weekNumber=this.weekNumber-1),r.weekday=e}else r.weekday=1;return"quarters"===n&&(r.month=(Math.ceil(this.month/3)-1)*3+1),this.set(r)}endOf(e,t){return this.isValid?this.plus({[e]:1}).startOf(e,t).minus(1):this}toFormat(e,t={}){return this.isValid?ty.create(this.loc.redefaultToEN(t)).formatDateTimeFromString(this,e):rS}toLocaleString(e=y,t={}){return this.isValid?ty.create(this.loc.clone(t),e).formatDateTime(this):rS}toLocaleParts(e={}){return this.isValid?ty.create(this.loc.clone(e),e).formatDateTimeParts(this):[]}toISO({format:e="extended",suppressSeconds:t=!1,suppressMilliseconds:r=!1,includeOffset:n=!0,extendedZone:i=!1,precision:a="milliseconds"}={}){if(!this.isValid)return null;a=r_(a);let s="extended"===e,o=rM(this,s,a);return rq.indexOf(a)>=3&&(o+="T"),o+=rN(this,s,t,r,n,i,a)}toISODate({format:e="extended",precision:t="day"}={}){return this.isValid?rM(this,"extended"===e,r_(t)):null}toISOWeekDate(){return rA(this,"kkkk-'W'WW-c")}toISOTime({suppressMilliseconds:e=!1,suppressSeconds:t=!1,includeOffset:r=!0,includePrefix:n=!1,extendedZone:i=!1,format:a="extended",precision:s="milliseconds"}={}){return this.isValid?(s=r_(s),(n&&rq.indexOf(s)>=3?"T":"")+rN(this,"extended"===a,t,e,r,i,s)):null}toRFC2822(){return rA(this,"EEE, dd LLL yyyy HH:mm:ss ZZZ",!1)}toHTTP(){return rA(this.toUTC(),"EEE, dd LLL yyyy HH:mm:ss 'GMT'")}toSQLDate(){return this.isValid?rM(this,!0):null}toSQLTime({includeOffset:e=!0,includeZone:t=!1,includeOffsetSpace:r=!0}={}){let n="HH:mm:ss.SSS";return(t||e)&&(r&&(n+=" "),t?n+="z":e&&(n+="ZZ")),rA(this,n,!0)}toSQL(e={}){return this.isValid?`${this.toSQLDate()} ${this.toSQLTime(e)}`:null}toString(){return this.isValid?this.toISO():rS}[Symbol.for("nodejs.util.inspect.custom")](){return this.isValid?`DateTime { ts: ${this.toISO()}, zone: ${this.zone.name}, locale: ${this.locale} }`:`DateTime { Invalid, reason: ${this.invalidReason} }`}valueOf(){return this.toMillis()}toMillis(){return this.isValid?this.ts:NaN}toSeconds(){return this.isValid?this.ts/1e3:NaN}toUnixInteger(){return this.isValid?Math.floor(this.ts/1e3):NaN}toJSON(){return this.toISO()}toBSON(){return this.toJSDate()}toObject(e={}){if(!this.isValid)return{};let t={...this.c};return e.includeConfig&&(t.outputCalendar=this.outputCalendar,t.numberingSystem=this.loc.numberingSystem,t.locale=this.loc.locale),t}toJSDate(){return new Date(this.isValid?this.ts:NaN)}diff(e,t="milliseconds",r={}){if(!this.isValid||!e.isValid)return ri.invalid("created by diffing an invalid DateTime");let n={locale:this.locale,numberingSystem:this.numberingSystem,...r},i=(Array.isArray(t)?t:[t]).map(ri.normalizeUnit),a=e.valueOf()>this.valueOf(),s=function(e,t,r,n){let[i,a,s,o]=function(e,t,r){let n,i,a={},s=e;for(let[o,l]of[["years",(e,t)=>t.year-e.year],["quarters",(e,t)=>t.quarter-e.quarter+(t.year-e.year)*4],["months",(e,t)=>t.month-e.month+(t.year-e.year)*12],["weeks",(e,t)=>{let r=rl(e,t);return(r-r%7)/7}],["days",rl]])r.indexOf(o)>=0&&(n=o,a[o]=l(e,t),(i=s.plus(a))>t?(a[o]--,(e=s.plus(a))>t&&(i=e,a[o]--,e=s.plus(a))):e=i);return[e,a,i,n]}(e,t,r),l=t-i,d=r.filter(e=>["hours","minutes","seconds","milliseconds"].indexOf(e)>=0);0===d.length&&(s<t&&(s=i.plus({[o]:1})),s!==i&&(a[o]=(a[o]||0)+l/(s-i)));let c=ri.fromObject(a,n);return d.length>0?ri.fromMillis(l,n).shiftTo(...d).plus(c):c}(a?this:e,a?e:this,i,n);return a?s.negate():s}diffNow(e="milliseconds",t={}){return this.diff(rz.now(),e,t)}until(e){return this.isValid?rs.fromDateTimes(this,e):this}hasSame(e,t,r){if(!this.isValid)return!1;let n=e.valueOf(),i=this.setZone(e.zone,{keepLocalTime:!0});return i.startOf(t,r)<=n&&n<=i.endOf(t,r)}equals(e){return this.isValid&&e.isValid&&this.valueOf()===e.valueOf()&&this.zone.equals(e.zone)&&this.loc.equals(e.loc)}toRelative(e={}){if(!this.isValid)return null;let t=e.base||rz.fromObject({},{zone:this.zone}),r=e.padding?this<t?-e.padding:e.padding:0,n=["years","months","days","hours","minutes","seconds"],i=e.unit;return Array.isArray(e.unit)&&(n=e.unit,i=void 0),r$(t,this.plus(r),{...e,numeric:"always",units:n,unit:i})}toRelativeCalendar(e={}){return this.isValid?r$(e.base||rz.fromObject({},{zone:this.zone}),this,{...e,numeric:"auto",units:["years","months","days"],calendary:!0}):null}static min(...e){if(!e.every(rz.isDateTime))throw new c("min requires all arguments be DateTimes");return e_(e,e=>e.valueOf(),Math.min)}static max(...e){if(!e.every(rz.isDateTime))throw new c("max requires all arguments be DateTimes");return e_(e,e=>e.valueOf(),Math.max)}static fromFormatExplain(e,t,r={}){let{locale:n=null,numberingSystem:i=null}=r;return rI(ei.fromOpts({locale:n,numberingSystem:i,defaultToEN:!0}),e,t)}static fromStringExplain(e,t,r={}){return rz.fromFormatExplain(e,t,r)}static buildFormatParser(e,t={}){let{locale:r=null,numberingSystem:n=null}=t;return new rE(ei.fromOpts({locale:r,numberingSystem:n,defaultToEN:!0}),e)}static fromFormatParser(e,t,r={}){if(eJ(e)||eJ(t))throw new c("fromFormatParser requires an input string and a format parser");let{locale:n=null,numberingSystem:i=null}=r,a=ei.fromOpts({locale:n,numberingSystem:i,defaultToEN:!0});if(!a.equals(t.locale))throw new c(`fromFormatParser called with a locale of ${a}, but the format parser was created for ${t.locale}`);let{result:s,zone:o,specificOffset:l,invalidReason:d}=t.explainFromTokens(e);return d?rz.invalid(d):rR(s,o,r,`format ${t.format}`,e,l)}static get DATE_SHORT(){return y}static get DATE_MED(){return f}static get DATE_MED_WITH_WEEKDAY(){return b}static get DATE_FULL(){return g}static get DATE_HUGE(){return K}static get TIME_SIMPLE(){return v}static get TIME_WITH_SECONDS(){return E}static get TIME_WITH_SHORT_OFFSET(){return I}static get TIME_WITH_LONG_OFFSET(){return w}static get TIME_24_SIMPLE(){return S}static get TIME_24_WITH_SECONDS(){return k}static get TIME_24_WITH_SHORT_OFFSET(){return j}static get TIME_24_WITH_LONG_OFFSET(){return x}static get DATETIME_SHORT(){return D}static get DATETIME_SHORT_WITH_SECONDS(){return C}static get DATETIME_MED(){return T}static get DATETIME_MED_WITH_SECONDS(){return O}static get DATETIME_MED_WITH_WEEKDAY(){return R}static get DATETIME_FULL(){return A}static get DATETIME_FULL_WITH_SECONDS(){return M}static get DATETIME_HUGE(){return N}static get DATETIME_HUGE_WITH_SECONDS(){return P}}function rH(e){if(rz.isDateTime(e))return e;if(e&&e.valueOf&&eL(e.valueOf()))return rz.fromJSDate(e);if(e&&"object"==typeof e)return rz.fromObject(e);throw new c(`Unknown datetime argument: ${e}, of type ${typeof e}`)}r.DateTime=rz,r.Duration=ri,r.FixedOffsetZone=es,r.IANAZone=G,r.Info=ro,r.Interval=rs,r.InvalidZone=eo,r.Settings=eI,r.SystemZone=q,r.VERSION="3.7.2",r.Zone=J},10531,(e,t,r)=>{"use strict";var n,i,a,s;Object.defineProperty(r,"__esModule",{value:!0}),r.CronDate=r.DAYS_IN_MONTH=r.DateMathOp=r.TimeUnit=void 0;let o=e.r(95057);(a=n||(r.TimeUnit=n={})).Second="Second",a.Minute="Minute",a.Hour="Hour",a.Day="Day",a.Month="Month",a.Year="Year",(s=i||(r.DateMathOp=i={})).Add="Add",s.Subtract="Subtract",r.DAYS_IN_MONTH=Object.freeze([31,29,31,30,31,30,31,31,30,31,30,31]);class l{#a;#s=null;#o=null;#l=null;constructor(e,t){const r={zone:t};if(e?e instanceof l?(this.#a=e.#a,this.#s=e.#s,this.#o=e.#o,this.#l=e.#l):e instanceof Date?this.#a=o.DateTime.fromJSDate(e,r):"number"==typeof e?this.#a=o.DateTime.fromMillis(e,r):(this.#a=o.DateTime.fromISO(e,r),this.#a.isValid||(this.#a=o.DateTime.fromRFC2822(e,r)),this.#a.isValid||(this.#a=o.DateTime.fromSQL(e,r)),this.#a.isValid||(this.#a=o.DateTime.fromFormat(e,"EEE, d MMM yyyy HH:mm:ss",r))):this.#a=o.DateTime.local(),!this.#a.isValid)throw Error(`CronDate: unhandled timestamp: ${e}`);t&&t!==this.#a.zoneName&&(this.#a=this.#a.setZone(t))}static #d(e){return e%4==0&&e%100!=0||e%400==0}get dstStart(){return this.#s}get dstStartLandingHour(){return this.#o}clearDstStart(){this.#s=null,this.#o=null}get dstEnd(){return this.#l}set dstEnd(e){this.#l=e}addYear(){this.#a=this.#a.plus({years:1})}addMonth(){this.#a=this.#a.plus({months:1}).startOf("month")}addDay(){this.#a=this.#a.plus({days:1}).startOf("day")}addHour(){this.#a=this.#a.plus({hours:1}).startOf("hour")}addMinute(){this.#a=this.#a.plus({minutes:1}).startOf("minute")}addSecond(){this.#a=this.#a.plus({seconds:1})}subtractYear(){this.#a=this.#a.minus({years:1})}subtractMonth(){this.#a=this.#a.minus({months:1}).endOf("month").startOf("second")}subtractDay(){this.#a=this.#a.minus({days:1}).endOf("day").startOf("second")}subtractHour(){this.#a=this.#a.minus({hours:1}).endOf("hour").startOf("second")}subtractMinute(){this.#a=this.#a.minus({minutes:1}).endOf("minute").startOf("second")}subtractSecond(){this.#a=this.#a.minus({seconds:1})}addUnit(e){switch(e){case n.Year:return this.addYear();case n.Month:return this.addMonth();case n.Day:return this.addDay();case n.Hour:return this.addHour();case n.Minute:return this.addMinute();case n.Second:return this.addSecond()}}subtractUnit(e){switch(e){case n.Year:return this.subtractYear();case n.Month:return this.subtractMonth();case n.Day:return this.subtractDay();case n.Hour:return this.subtractHour();case n.Minute:return this.subtractMinute();case n.Second:return this.subtractSecond()}}invokeDateOperation(e,t){if(e===i.Add)return void this.addUnit(t);if(e===i.Subtract)return void this.subtractUnit(t);throw Error(`Invalid verb: ${e}`)}getDate(){return this.#a.day}getFullYear(){return this.#a.year}getDay(){let e=this.#a.weekday;return 7===e?0:e}getMonth(){return this.#a.month-1}getHours(){return this.#a.hour}getMinutes(){return this.#a.minute}getSeconds(){return this.#a.second}getMilliseconds(){return this.#a.millisecond}getUTCOffset(){return this.#a.offset}setStartOfDay(){this.#a=this.#a.startOf("day")}setEndOfDay(){this.#a=this.#a.endOf("day")}getTime(){return this.#a.valueOf()}getUTCDate(){return this.#c().day}getUTCFullYear(){return this.#c().year}getUTCDay(){let e=this.#c().weekday;return 7===e?0:e}getUTCMonth(){return this.#c().month-1}getUTCHours(){return this.#c().hour}getUTCMinutes(){return this.#c().minute}getUTCSeconds(){return this.#c().second}toISOString(){return this.#a.toUTC().toISO()}toJSON(){return this.#a.toJSON()}setDate(e){this.#a=this.#a.set({day:e})}setFullYear(e){this.#a=this.#a.set({year:e})}setDay(e){this.#a=this.#a.set({weekday:e})}setMonth(e){this.#a=this.#a.set({month:e+1})}setHours(e){this.#a=this.#a.set({hour:e})}setMinutes(e){this.#a=this.#a.set({minute:e})}setSeconds(e){this.#a=this.#a.set({second:e})}setMilliseconds(e){this.#a=this.#a.set({millisecond:e})}toString(){return this.toDate().toString()}toDate(){return this.#a.toJSDate()}isLastDayOfMonth(){let{day:e,month:t}=this.#a;if(2===t){let n=l.#d(this.#a.year);return e===r.DAYS_IN_MONTH[t-1]-!n}return e===r.DAYS_IN_MONTH[t-1]}isLastWeekdayOfMonth(){let{day:e,month:t}=this.#a;return e>(2===t?r.DAYS_IN_MONTH[t-1]-!l.#d(this.#a.year):r.DAYS_IN_MONTH[t-1])-7}applyDateOperation(e,t,r){if(t===n.Month||t===n.Day)return void this.invokeDateOperation(e,t);let a=this.getHours(),s=this.getUTCOffset();this.invokeDateOperation(e,t);let o=this.getHours(),l=(o-a+24)%24;e===i.Add&&this.getUTCOffset()>s&&l>=2?24!==r&&(this.#s=(a+1)%24,this.#o=o):0===l&&0===this.getMinutes()&&0===this.getSeconds()&&24!==r&&(this.dstEnd=o)}#c(){return this.#a.toUTC()}}r.CronDate=l,r.default=l},35155,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronMonth=void 0;let n=e.r(10531),i=e.r(24284),a=Object.freeze([]);class s extends i.CronField{static get min(){return 1}static get max(){return 12}static get chars(){return a}static get daysInMonth(){return n.DAYS_IN_MONTH}constructor(e,t){super(e,t),this.validate()}get values(){return super.values}}r.CronMonth=s},36644,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronDayOfMonth=void 0;let n=e.r(24284),i=e.r(35155),a=Object.freeze(["L"]);class s extends n.CronField{static fromMonth(e,t,r){if(1!==e.length)return new s(t,r);let n=i.CronMonth.daysInMonth[e[0]-1],a=t.filter(e=>"number"!=typeof e||e<=n);return new s(a.length>0?a:t,r)}static get min(){return 1}static get max(){return 31}static get chars(){return a}static get validChars(){return/^[?,*\dLH/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/}constructor(e,t){super(e,t),this.validate()}get values(){return super.values}}r.CronDayOfMonth=s},27131,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronDayOfWeek=void 0;let n=e.r(24284),i=Object.freeze(["L"]);class a extends n.CronField{static get min(){return 0}static get max(){return 7}static get chars(){return i}static get validChars(){return/^[?,*\dLH#/-]+$|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$/}constructor(e,t){if(super(e,t),this.validate(),this.values.some(e=>"L"===e))throw Error(`${this.constructor.name} Validation error, unexpected standalone L`)}get values(){return super.values}get nthDay(){return this.options.nthDayOfWeek??0}}r.CronDayOfWeek=a},86662,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronHour=void 0;let n=e.r(24284),i=Object.freeze([]);class a extends n.CronField{static get min(){return 0}static get max(){return 23}static get chars(){return i}constructor(e,t){super(e,t),this.validate()}get values(){return super.values}}r.CronHour=a},84036,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronMinute=void 0;let n=e.r(24284),i=Object.freeze([]);class a extends n.CronField{static get min(){return 0}static get max(){return 59}static get chars(){return i}constructor(e,t){super(e,t),this.validate()}get values(){return super.values}}r.CronMinute=a},78956,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronSecond=void 0;let n=e.r(24284),i=Object.freeze([]);class a extends n.CronField{static get min(){return 0}static get max(){return 59}static get chars(){return i}constructor(e,t){super(e,t),this.validate()}get values(){return super.values}}r.CronSecond=a},89584,(e,t,r)=>{"use strict";var n=e.e&&e.e.__createBinding||(Object.create?function(e,t,r,n){void 0===n&&(n=r);var i=Object.getOwnPropertyDescriptor(t,r);(!i||("get"in i?!t.__esModule:i.writable||i.configurable))&&(i={enumerable:!0,get:function(){return t[r]}}),Object.defineProperty(e,n,i)}:function(e,t,r,n){void 0===n&&(n=r),e[n]=t[r]}),i=e.e&&e.e.__exportStar||function(e,t){for(var r in e)"default"===r||Object.prototype.hasOwnProperty.call(t,r)||n(t,e,r)};Object.defineProperty(r,"__esModule",{value:!0}),i(e.r(52174),r),i(e.r(36644),r),i(e.r(27131),r),i(e.r(24284),r),i(e.r(86662),r),i(e.r(84036),r),i(e.r(35155),r),i(e.r(78956),r)},41680,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronFieldCollection=void 0;let n=e.r(89584);r.CronFieldCollection=class e{#u;#h;#p;#m;#y;#f;static from(t,r){return new e({second:this.resolveField(n.CronSecond,t.second,r.second),minute:this.resolveField(n.CronMinute,t.minute,r.minute),hour:this.resolveField(n.CronHour,t.hour,r.hour),dayOfMonth:this.resolveField(n.CronDayOfMonth,t.dayOfMonth,r.dayOfMonth),month:this.resolveField(n.CronMonth,t.month,r.month),dayOfWeek:this.resolveField(n.CronDayOfWeek,t.dayOfWeek,r.dayOfWeek)})}static resolveField(e,t,r){return r?r instanceof n.CronField?r:new e(r):t}constructor({second:e,minute:t,hour:r,dayOfMonth:i,month:a,dayOfWeek:s}){if(!e)throw Error("Validation error, Field second is missing");if(!t)throw Error("Validation error, Field minute is missing");if(!r)throw Error("Validation error, Field hour is missing");if(!i)throw Error("Validation error, Field dayOfMonth is missing");if(!a)throw Error("Validation error, Field month is missing");if(!s)throw Error("Validation error, Field dayOfWeek is missing");if(1===a.values.length&&!i.hasLastChar&&s.isWildcard&&!(parseInt(i.values[0],10)<=n.CronMonth.daysInMonth[a.values[0]-1]))throw Error("Invalid explicit day of month definition");this.#u=e,this.#h=t,this.#p=r,this.#y=a,this.#f=s,this.#m=i}get second(){return this.#u}get minute(){return this.#h}get hour(){return this.#p}get dayOfMonth(){return this.#m}get month(){return this.#y}get dayOfWeek(){return this.#f}static compactField(e){let t;if(0===e.length)return[];let r=[];return e.forEach((e,n,i)=>{if(void 0===t){t={start:e,count:1};return}let a=i[n-1]||t.start,s=i[n+1];if("L"===e||"W"===e){r.push(t),r.push({start:e,count:1}),t=void 0;return}if(void 0===t.step&&void 0!==s){let r=e-a;if(r<=s-e){t={...t,count:2,end:e,step:r};return}t.step=1}e-(t.end??0)===t.step?(t.count++,t.end=e):(1===t.count?r.push({start:t.start,count:1}):2===t.count?(r.push({start:t.start,count:1}),r.push({start:t.end??a,count:1})):r.push(t),t={start:e,count:1})}),t&&r.push(t),r}static #b(e,t,r){let i=t.step;return i?1===i&&t.start===e.min&&t.end&&t.end>=r?(e instanceof n.CronDayOfMonth||e instanceof n.CronDayOfWeek)&&!e.isWildcard?null:e.hasQuestionMarkChar?"?":"*":1!==i&&t.start===e.min&&t.end&&t.end>=r-i+1?`*/${i}`:null:null}static #g(e){let t=e.step;if(1===t)return`${e.start}-${e.end}`;let r=0===e.start?e.count-1:e.count;if(!t)throw Error("Unexpected range step");if(!e.end)throw Error("Unexpected range end");if(t*r>e.end){if("number"!=typeof e.start)throw Error("Unexpected range start");return Array.from({length:e.end-e.start+1},(r,n)=>{if("number"!=typeof e.start)throw Error("Unexpected range start");return n%t==0?e.start+n:null}).filter(e=>null!==e).join(",")}return`${e.start}-${e.end}/${t}`}stringifyField(t){let r=t.max,i=t.values;if(t instanceof n.CronDayOfWeek){r=6;let e=this.#f.values;i=7===e[e.length-1]?e.slice(0,-1):e}t instanceof n.CronDayOfMonth&&(r=1===this.#y.values.length?n.CronMonth.daysInMonth[this.#y.values[0]-1]:t.max);let a=e.compactField(i);if(1===a.length){let n=e.#b(t,a[0],r);if(n)return n}return a.map(r=>{let i=1===r.count?r.start.toString():e.#g(r);return t instanceof n.CronDayOfWeek&&t.nthDay>0?`${i}#${t.nthDay}`:i}).join(",")}stringify(e=!1){let t=[];return e&&t.push(this.stringifyField(this.#u)),t.push(this.stringifyField(this.#h),this.stringifyField(this.#p),this.stringifyField(this.#m),this.stringifyField(this.#y),this.stringifyField(this.#f)),t.join(" ")}serialize(){return{second:this.#u.serialize(),minute:this.#h.serialize(),hour:this.#p.serialize(),dayOfMonth:this.#m.serialize(),month:this.#y.serialize(),dayOfWeek:this.#f.serialize()}}}},14397,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronExpression=r.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE=r.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE=void 0;let n=e.r(10531);r.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE="Out of the time span range",r.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE="Invalid expression, loop limit exceeded";class i{#K;#v;#E;#I;#w;#S;#k=null;#j=!1;constructor(e,t){this.#K=t,this.#v=t.tz,this.#I=t.startDate?new n.CronDate(t.startDate,this.#v):null,this.#w=t.endDate?new n.CronDate(t.endDate,this.#v):null;let r=t.currentDate??t.startDate;if(r){const e=new n.CronDate(r,this.#v);this.#I&&e.getTime()<this.#I.getTime()?r=this.#I:this.#w&&e.getTime()>this.#w.getTime()&&(r=this.#w)}this.#E=new n.CronDate(r,this.#v),this.#S=e}get fields(){return this.#S}static fieldsToExpression(e,t){return new i(e,t||{})}static #x(e,t){return t.some(t=>t===e)}#D(e,t){return e[t?e.length-1:0]}#C(e){let t=`${e.getFullYear()}-${e.getMonth()+1}-${e.getDate()}`;if(this.#k===t)return this.#j;let r=new n.CronDate(e);r.setStartOfDay();let i=new n.CronDate(e);return i.setEndOfDay(),this.#k=t,this.#j=r.getUTCOffset()!==i.getUTCOffset(),this.#j}#T(e,t,r){let i=this.#S.second.values,a=e.getSeconds(),s=this.#S.second.findNearestValue(a,r);null!==s?e.setSeconds(s):(e.applyDateOperation(t,n.TimeUnit.Minute,this.#S.hour.values.length),e.setSeconds(this.#D(i,r)))}#O(e,t,r){let i=this.#S.minute.values,a=this.#S.second.values,s=e.getMinutes(),o=this.#S.minute.findNearestValue(s,r);if(null!==o){e.setMinutes(o),e.setSeconds(this.#D(a,r));return}e.applyDateOperation(t,n.TimeUnit.Hour,this.#S.hour.values.length),e.setMinutes(this.#D(i,r)),e.setSeconds(this.#D(a,r))}static #R(e,t){if(!t.isLastWeekdayOfMonth())return!1;let r=t.getDay();return e.some(e=>r===parseInt(e.toString().charAt(0),10)%7)}static #A(e,t){return e<=0||Math.ceil(t.getDate()/7)===e}next(){return this.#M()}prev(){return this.#M(!0)}hasNext(){let e=this.#E;try{return this.#M(),!0}catch{return!1}finally{this.#E=e}}hasPrev(){let e=this.#E;try{return this.#M(!0),!0}catch{return!1}finally{this.#E=e}}take(e){let t=[];if(e>=0)for(let r=0;r<e;r++)try{t.push(this.next())}catch{break}else for(let r=0;r>e;r--)try{t.push(this.prev())}catch{break}return t}reset(e){this.#E=new n.CronDate(e||this.#K.currentDate,this.#v)}stringify(e=!1){return this.#S.stringify(e)}includesDate(e){let{second:t,minute:r,hour:i,month:a}=this.#S,s=new n.CronDate(e,this.#v);return!!t.values.includes(s.getSeconds())&&!!r.values.includes(s.getMinutes())&&!!i.values.includes(s.getHours())&&!!a.values.includes(s.getMonth()+1)&&!!this.#N(s)}toString(){return this.#K.expression||this.stringify(!0)}#N(e){let t=this.#S.dayOfMonth.isWildcard,r=this.#S.dayOfWeek.isWildcard,n=!r,a=i.#x(e.getDate(),this.#S.dayOfMonth.values)||this.#S.dayOfMonth.hasLastChar&&e.isLastDayOfMonth(),s=this.#S.dayOfWeek.nthDay,o=i.#x(e.getDay(),this.#S.dayOfWeek.values)&&i.#A(s,e)||this.#S.dayOfWeek.hasLastChar&&i.#R(this.#S.dayOfWeek.values,e);return!t&&!!n&&(!!a||!!o)||!!a&&!n||!!t&&!r&&!!o}#P(e,t,r){let a=this.#S.hour.values,s=e.getHours(),o=i.#x(s,a),l=e.dstEnd===s;if(null!==e.dstStart&&e.dstStartLandingHour===s){for(let t=e.dstStart;t!==s;t=(t+1)%24)if(i.#x(t,a))return!0}if(l&&!r)return e.dstEnd=null,e.applyDateOperation(n.DateMathOp.Add,n.TimeUnit.Hour,a.length),!1;if(o)return!0;e.clearDstStart();let d=this.#S.hour.findNearestValue(s,r);if(null===d)return e.applyDateOperation(t,n.TimeUnit.Day,a.length),!1;if(this.#C(e)){let i=r?s-d:d-s;for(let s=0;s<i&&(e.applyDateOperation(t,n.TimeUnit.Hour,a.length),!(!r&&e.getHours()>=d||r&&e.getHours()<=d));s++);}else e.setHours(d);return e.setMinutes(this.#D(this.#S.minute.values,r)),e.setSeconds(this.#D(this.#S.second.values,r)),!1}#J(e){if(!this.#I&&!this.#w)return;let t=e.getTime();if(this.#I&&t<this.#I.getTime()||this.#w&&t>this.#w.getTime())throw Error(r.TIME_SPAN_OUT_OF_BOUNDS_ERROR_MESSAGE)}#M(e=!1){let t=e?n.DateMathOp.Subtract:n.DateMathOp.Add,a=new n.CronDate(this.#E),s=a.getTime();a.getMilliseconds()>0&&(a.setMilliseconds(0),e||a.applyDateOperation(n.DateMathOp.Add,n.TimeUnit.Second,this.#S.hour.values.length));let o=0;for(;++o<1e4;){if(this.#J(a),!this.#N(a)){a.applyDateOperation(t,n.TimeUnit.Day,this.#S.hour.values.length);continue}if(!i.#x(a.getMonth()+1,this.#S.month.values)){a.applyDateOperation(t,n.TimeUnit.Month,this.#S.hour.values.length);continue}if(this.#P(a,t,e)){if(!i.#x(a.getMinutes(),this.#S.minute.values)){this.#O(a,t,e);continue}if(!i.#x(a.getSeconds(),this.#S.second.values)){this.#T(a,t,e);continue}if(s===a.getTime()){a.applyDateOperation(t,n.TimeUnit.Second,this.#S.hour.values.length);continue}break}}if(o>=1e4)throw Error(r.LOOPS_LIMIT_EXCEEDED_ERROR_MESSAGE);return this.#E=a,a}[Symbol.iterator](){return{next:()=>{try{return{value:this.#M(),done:!1}}catch{return{value:void 0,done:!0}}}}}}r.CronExpression=i,r.default=i},82419,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.seededRandom=function(e){var t;return t=e?(function(e){let t=0x811c9dc5;for(let r=0;r<e.length;r++)t^=e.charCodeAt(r),t=Math.imul(t,0x1000193);return()=>t>>>0})(e)():Math.floor(1e10*Math.random()),()=>{let e=t+=0x6d2b79f5;return e=Math.imul(e^e>>>15,1|e),(((e^=e+Math.imul(e^e>>>7,61|e))^e>>>14)>>>0)/0x100000000}}},46810,(e,t,r)=>{"use strict";var n,i,a,s,o,l,d,c;Object.defineProperty(r,"__esModule",{value:!0}),r.CronExpressionParser=r.DayOfWeek=r.Months=r.CronUnit=r.PredefinedExpressions=void 0;let u=e.r(41680),h=e.r(14397),p=e.r(82419),m=e.r(89584);(o=n||(r.PredefinedExpressions=n={}))["@yearly"]="0 0 0 1 1 *",o["@annually"]="0 0 0 1 1 *",o["@monthly"]="0 0 0 1 * *",o["@weekly"]="0 0 0 * * 0",o["@daily"]="0 0 0 * * *",o["@hourly"]="0 0 * * * *",o["@minutely"]="0 * * * * *",o["@secondly"]="* * * * * *",o["@weekdays"]="0 0 0 * * 1-5",o["@weekends"]="0 0 0 * * 0,6",(l=i||(r.CronUnit=i={})).Second="Second",l.Minute="Minute",l.Hour="Hour",l.DayOfMonth="DayOfMonth",l.Month="Month",l.DayOfWeek="DayOfWeek",(d=a||(r.Months=a={}))[d.jan=1]="jan",d[d.feb=2]="feb",d[d.mar=3]="mar",d[d.apr=4]="apr",d[d.may=5]="may",d[d.jun=6]="jun",d[d.jul=7]="jul",d[d.aug=8]="aug",d[d.sep=9]="sep",d[d.oct=10]="oct",d[d.nov=11]="nov",d[d.dec=12]="dec",(c=s||(r.DayOfWeek=s={}))[c.sun=0]="sun",c[c.mon=1]="mon",c[c.tue=2]="tue",c[c.wed=3]="wed",c[c.thu=4]="thu",c[c.fri=5]="fri",c[c.sat=6]="sat",r.CronExpressionParser=class e{static parse(t,r={}){let{strict:a=!1,hashSeed:s}=r,o=(0,p.seededRandom)(s);t=n[t]||t;let l=e.#L(t,a);if(!("*"===l.dayOfMonth||"*"===l.dayOfWeek||!a))throw Error("Cannot use both dayOfMonth and dayOfWeek together in strict mode!");let d=e.#q(i.Second,l.second,m.CronSecond.constraints,o,a),c=e.#q(i.Minute,l.minute,m.CronMinute.constraints,o,a),y=e.#q(i.Hour,l.hour,m.CronHour.constraints,o,a),f=e.#q(i.Month,l.month,m.CronMonth.constraints,o,a),b=e.#q(i.DayOfMonth,l.dayOfMonth,m.CronDayOfMonth.constraints,o,a),{dayOfWeek:g,nthDayOfWeek:K}=e.#F(l.dayOfWeek),v=e.#q(i.DayOfWeek,g,m.CronDayOfWeek.constraints,o,a),E=new u.CronFieldCollection({second:new m.CronSecond(d,{rawValue:l.second}),minute:new m.CronMinute(c,{rawValue:l.minute}),hour:new m.CronHour(y,{rawValue:l.hour}),dayOfMonth:m.CronDayOfMonth.fromMonth(f,b,{rawValue:l.dayOfMonth}),month:new m.CronMonth(f,{rawValue:l.month}),dayOfWeek:new m.CronDayOfWeek(v,{rawValue:l.dayOfWeek,nthDayOfWeek:K})});return new h.CronExpression(E,{...r,expression:t})}static #L(e,t){if(t&&!e.length)throw Error("Invalid cron expression");let r=(e=e||"0 * * * * *").trim().split(/\s+/);if(t&&r.length<6)throw Error("Invalid cron expression, expected 6 fields");if(r.length>6)throw Error("Invalid cron expression, too many fields");let n=["0","*","*","*","*","*"];r.length<n.length&&r.unshift(...n.slice(0,n.length-r.length));let[i,a,s,o,l,d]=r;return{second:i,minute:a,hour:s,dayOfMonth:o,month:l,dayOfWeek:d}}static #q(e,t,r,n,o){if((e===i.Month||e===i.DayOfWeek)&&(t=t.replace(/[a-z]{3}/gi,e=>{let t=a[e=e.toLowerCase()]||s[e];if(void 0===t)throw Error(`Validation error, cannot resolve alias "${e}"`);return t.toString()})),!r.validChars.test(t))throw Error(`Invalid characters, got value: ${t}`);return t=this.#V(t,r),t=this.#_(t,r,n,e,o),this.#G(e,t,r)}static #V(e,t){return e.replace(/[*?]/g,t.min+"-"+t.max)}static #_(t,r,n,i,a){let s=n();return t.replace(/H(?:\((\d+)-(\d+)\))?(?:\/(\d+))?/g,(t,n,o,l)=>{if(n&&o&&l){let t=parseInt(n,10),d=parseInt(o,10),c=parseInt(l,10);if(c<=0)throw Error(`Invalid step: ${c}, must be positive`);let u=e.#Y(t,d,r,i,a);return e.#$(s,u.min,u.max,c,i,a)}if(n&&o){let t=parseInt(n,10),l=parseInt(o,10),d=e.#Y(t,l,r,i,a);return String(e.#W(s,d.min,d.max))}if(!l)return String(e.#W(s,r.min,r.max));{let t=parseInt(l,10);if(t<=0)throw Error(`Invalid step: ${t}, must be positive`);return e.#$(s,r.min,r.max,t,i,a)}})}static #W(e,t,r){return Math.floor(e*(r-t+1))+t}static #U(e){return e.charAt(0).toLowerCase()+e.slice(1)}static #Y(t,r,n,i,a){if(t>r)throw Error(`Invalid range: ${t}-${r}, min > max`);if(a&&(t<n.min||r>n.max))throw Error(`Invalid range: ${t}-${r}, outside the ${n.min}-${n.max} range of the ${e.#U(i)} field`);let s=Math.max(t,n.min),o=Math.min(r,n.max);if(s>o)throw Error(`Invalid range: ${t}-${r}, no usable value in the ${e.#U(i)} field`);return{min:s,max:o}}static #$(t,r,n,i,a,s){if(s&&i>n-r+1)throw Error(`Invalid step: ${i}, wider than the ${r}-${n} range of the ${e.#U(a)} field`);let o=Math.floor(t*i),l=[];for(let e=Math.floor(r/i)*i+o;e<=n;e+=i)e>=r&&l.push(e);return 0===l.length?String(e.#W(t,r,n)):l.join(",")}static #G(t,r,n){let a=[];for(let s of r.split(",")){if(a.length>256)throw Error(`Constraint error, too many values in ${t} field, expected at most 256`);if(!(s.length>0))throw Error("Invalid list value format");!function(r,n){if(Array.isArray(r))a.push(...r);else if(e.#z(n,r))a.push(r);else{let e=parseInt(r.toString(),10);if(!(e>=n.min&&e<=n.max))throw Error(`Constraint error, got value ${r} expected range ${n.min}-${n.max}`);a.push(t===i.DayOfWeek?e%7:r)}}(e.#H(t,s,n),n)}return a}static #H(t,r,n){let i=r.split("/");if(i.length>2)throw Error(`Invalid repeat: ${r}`);return 2===i.length?(i[0].includes("-")||(i[0]=`${i[0]}-${n.max}`),e.#B(t,i[0],parseInt(i[1],10),n)):e.#B(t,r,1,n)}static #Z(e,t,r){if(!(!isNaN(e)&&!isNaN(t)&&e>=r.min&&t<=r.max))throw Error(`Constraint error, got range ${e}-${t} expected range ${r.min}-${r.max}`);if(e>t)throw Error(`Invalid range: ${e}-${t}, min(${e}) > max(${t})`)}static #X(e){if(!(!isNaN(e)&&e>0))throw Error(`Constraint error, cannot repeat at every ${e} time.`)}static #Q(e,t,r,n){let a=[];e===i.DayOfWeek&&r%7==0&&(r-t)%n==0&&a.push(0);for(let e=t;e<=r;e+=n)-1===a.indexOf(e)&&a.push(e);return a}static #B(e,t,r,n){let i=t.split("-");if(i.length<=1)return isNaN(+t)?t:+t;let[a,s]=i.map(e=>parseInt(e,10));return this.#Z(a,s,n),this.#X(r),this.#Q(e,a,s,r)}static #F(e){let t=e.split("#");if(t.length<=1)return{dayOfWeek:t[0]};let r=+t[t.length-1],n=e.match(/([,\-/])/);if(null!==n)throw Error(`Constraint error, invalid dayOfWeek \`#\` and \`${n?.[0]}\` special characters are incompatible`);if(!(t.length<=2&&!isNaN(r)&&r>=1&&r<=5))throw Error("Constraint error, invalid dayOfWeek occurrence number (#)");return{dayOfWeek:t[0],nthDayOfWeek:r}}static #z(e,t){return e.chars.some(e=>t.toString().includes(e))}}},24868,(e,t,r)=>{t.exports=e.x("fs/promises",()=>require("fs/promises"))},37835,(e,t,r)=>{"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.CronFileParser=void 0;let n=e.r(46810);r.CronFileParser=class t{static async parseFile(r){let{readFile:n}=e.r(24868),i=await n(r,"utf8");return t.#ee(i)}static parseFileSync(r){let{readFileSync:n}=e.r(22734),i=n(r,"utf8");return t.#ee(i)}static #ee(e){let r=e.split("\n"),n={variables:{},expressions:[],errors:{}};for(let e of r){let r=e.trim();if(0===r.length||r.startsWith("#"))continue;let i=r.match(/^(.*)=(.*)$/);if(i){let[,e,t]=i;n.variables[e]=t.replace(/["']/g,"");continue}try{let e=t.#et(r);n.expressions.push(e.interval)}catch(e){n.errors[r]=e}}return n}static #et(e){let t=e.split(" ");return{interval:n.CronExpressionParser.parse(t.slice(0,5).join(" ")),command:t.slice(5,t.length)}}}},8689,(e,t,r)=>{"use strict";var n=e.e&&e.e.__createBinding||(Object.create?function(e,t,r,n){void 0===n&&(n=r);var i=Object.getOwnPropertyDescriptor(t,r);(!i||("get"in i?!t.__esModule:i.writable||i.configurable))&&(i={enumerable:!0,get:function(){return t[r]}}),Object.defineProperty(e,n,i)}:function(e,t,r,n){void 0===n&&(n=r),e[n]=t[r]}),i=e.e&&e.e.__exportStar||function(e,t){for(var r in e)"default"===r||Object.prototype.hasOwnProperty.call(t,r)||n(t,e,r)};Object.defineProperty(r,"__esModule",{value:!0}),r.CronFileParser=r.CronExpressionParser=r.CronExpression=r.CronFieldCollection=r.CronDate=void 0;let a=e.r(46810);var s=e.r(10531);Object.defineProperty(r,"CronDate",{enumerable:!0,get:function(){return s.CronDate}});var o=e.r(41680);Object.defineProperty(r,"CronFieldCollection",{enumerable:!0,get:function(){return o.CronFieldCollection}});var l=e.r(14397);Object.defineProperty(r,"CronExpression",{enumerable:!0,get:function(){return l.CronExpression}});var d=e.r(46810);Object.defineProperty(r,"CronExpressionParser",{enumerable:!0,get:function(){return d.CronExpressionParser}});var c=e.r(37835);Object.defineProperty(r,"CronFileParser",{enumerable:!0,get:function(){return c.CronFileParser}}),i(e.r(89584),r),r.default=a.CronExpressionParser},6516,e=>{"use strict";let t,r,n,i,a,s,o,l;class d{static normalize(e){return Number.isFinite(e)?{type:"fixed",delay:e}:e||void 0}static calculate(e,t,r,n,i){if(e)return(function(e,t){if(e.type in d.builtinStrategies)return d.builtinStrategies[e.type](e.delay,e.jitter);if(t)return t;throw Error(`Unknown backoff strategy ${e.type}.
      If a custom backoff strategy is used, specify it when the queue is created.`)})(e,i)(t,e.type,r,n)}}d.builtinStrategies={fixed:function(e,t=0){return function(){return t>0?Math.floor(Math.random()*e*t+e*(1-t)):e}},exponential:function(e,t=0){return function(r){if(!(t>0))return Math.round(Math.pow(2,r-1)*e);{let n=Math.round(Math.pow(2,r-1)*e);return Math.floor(Math.random()*n*t+n*(1-t))}}}},e.s(["Backoffs",0,d],72844);var c,u,h,p,m,y,f,b,g,K,v,E,I,w,S,k,j,x,D,C,T,O,R,A,M,N,P=e.i(33405),J=e.i(4446),L=e.i(37702);(c=K||(K={}))[c.Init=0]="Init",c[c.Start=1]="Start",c[c.Stop=2]="Stop",c[c.GetChildrenValuesResponse=3]="GetChildrenValuesResponse",c[c.GetIgnoredChildrenFailuresResponse=4]="GetIgnoredChildrenFailuresResponse",c[c.GetDependenciesCountResponse=5]="GetDependenciesCountResponse",c[c.MoveToWaitingChildrenResponse=6]="MoveToWaitingChildrenResponse",c[c.Cancel=7]="Cancel",c[c.GetDependenciesResponse=8]="GetDependenciesResponse",e.s(["ChildCommand",0,K],84541),(u=v||(v={}))[u.JobNotExist=-1]="JobNotExist",u[u.JobLockNotExist=-2]="JobLockNotExist",u[u.JobNotInState=-3]="JobNotInState",u[u.JobPendingChildren=-4]="JobPendingChildren",u[u.ParentJobNotExist=-5]="ParentJobNotExist",u[u.JobLockMismatch=-6]="JobLockMismatch",u[u.ParentJobCannotBeReplaced=-7]="ParentJobCannotBeReplaced",u[u.JobBelongsToJobScheduler=-8]="JobBelongsToJobScheduler",u[u.JobHasFailedChildren=-9]="JobHasFailedChildren",u[u.SchedulerJobIdCollision=-10]="SchedulerJobIdCollision",u[u.SchedulerJobSlotsBusy=-11]="SchedulerJobSlotsBusy",e.s(["ErrorCode",0,v],52885),(h=E||(E={}))[h.Completed=0]="Completed",h[h.Error=1]="Error",h[h.Failed=2]="Failed",h[h.InitFailed=3]="InitFailed",h[h.InitCompleted=4]="InitCompleted",h[h.Log=5]="Log",h[h.MoveToDelayed=6]="MoveToDelayed",h[h.MoveToWait=7]="MoveToWait",h[h.Progress=8]="Progress",h[h.Update=9]="Update",h[h.GetChildrenValues=10]="GetChildrenValues",h[h.GetIgnoredChildrenFailures=11]="GetIgnoredChildrenFailures",h[h.GetDependenciesCount=12]="GetDependenciesCount",h[h.MoveToWaitingChildren=13]="MoveToWaitingChildren",h[h.GetDependencies=14]="GetDependencies",e.s(["ParentCommand",0,E],39845),(p=I||(I={}))[p.ONE_MINUTE=1]="ONE_MINUTE",p[p.FIVE_MINUTES=5]="FIVE_MINUTES",p[p.FIFTEEN_MINUTES=15]="FIFTEEN_MINUTES",p[p.THIRTY_MINUTES=30]="THIRTY_MINUTES",p[p.ONE_HOUR=60]="ONE_HOUR",p[p.ONE_WEEK=10080]="ONE_WEEK",p[p.TWO_WEEKS=20160]="TWO_WEEKS",p[p.ONE_MONTH=80640]="ONE_MONTH",e.s(["MetricsTime",0,I],43044),(m=w||(w={})).QueueName="bullmq.queue.name",m.QueueOperation="bullmq.queue.operation",m.BulkCount="bullmq.job.bulk.count",m.BulkNames="bullmq.job.bulk.names",m.JobName="bullmq.job.name",m.JobId="bullmq.job.id",m.JobKey="bullmq.job.key",m.JobIds="bullmq.job.ids",m.JobAttemptsMade="bullmq.job.attempts.made",m.DeduplicationKey="bullmq.job.deduplication.key",m.JobOptions="bullmq.job.options",m.JobProgress="bullmq.job.progress",m.QueueDrainDelay="bullmq.queue.drain.delay",m.QueueGrace="bullmq.queue.grace",m.QueueCleanLimit="bullmq.queue.clean.limit",m.QueueCleanCount="bullmq.queue.clean.count",m.QueueRateLimit="bullmq.queue.rate.limit",m.JobType="bullmq.job.type",m.QueueOptions="bullmq.queue.options",m.QueueEventMaxLength="bullmq.queue.event.max.length",m.QueueJobsState="bullmq.queue.jobs.state",m.WorkerOptions="bullmq.worker.options",m.WorkerName="bullmq.worker.name",m.WorkerId="bullmq.worker.id",m.WorkerRateLimit="bullmq.worker.rate.limit",m.WorkerDoNotWaitActive="bullmq.worker.do.not.wait.active",m.WorkerForceClose="bullmq.worker.force.close",m.WorkerStalledJobs="bullmq.worker.stalled.jobs",m.WorkerFailedJobs="bullmq.worker.failed.jobs",m.WorkerJobsToExtendLocks="bullmq.worker.jobs.to.extend.locks",m.JobAttemptFinishedTimestamp="bullmq.job.attempt_finished_timestamp",m.JobProcessedTimestamp="bullmq.job.processed.timestamp",m.JobResult="bullmq.job.result",m.JobFailedReason="bullmq.job.failed.reason",m.FlowName="bullmq.flow.name",m.JobSchedulerId="bullmq.job.scheduler.id",m.JobState="bullmq.job.state",(y=S||(S={})).QueueJobsCount="bullmq.queue.jobs",y.JobsCompleted="bullmq.jobs.completed",y.JobsFailed="bullmq.jobs.failed",y.JobsDelayed="bullmq.jobs.delayed",y.JobsRetried="bullmq.jobs.retried",y.JobsWaiting="bullmq.jobs.waiting",y.JobsWaitingChildren="bullmq.jobs.waiting_children",y.JobDuration="bullmq.job.duration",(f=k||(k={}))[f.INTERNAL=0]="INTERNAL",f[f.SERVER=1]="SERVER",f[f.CLIENT=2]="CLIENT",f[f.PRODUCER=3]="PRODUCER",f[f.CONSUMER=4]="CONSUMER",e.s(["MetricNames",0,S,"SpanKind",0,k,"TelemetryAttributes",0,w],40723),e.s([],59902);var q=e.i(27699);let F={1:"Uncaught Fatal Exception",2:"Unused",3:"Internal JavaScript Parse Error",4:"Internal JavaScript Evaluation Failure",5:"Fatal Error",6:"Non-function Internal Exception Handler",7:"Internal Exception Handler Run-Time Failure",8:"Unused",9:"Invalid Argument",10:"Internal JavaScript Run-Time Failure",12:"Invalid Debug Argument",13:"Unfinished Top-Level Await"};class V extends q.EventEmitter{constructor(e,t,r={useWorkerThreads:!1}){super(),this.mainFile=e,this.processFile=t,this.opts=r,this._exitCode=null,this._signalCode=null,this._killed=!1}get pid(){if(this.childProcess)return this.childProcess.pid;if(this.worker)return Math.abs(this.worker.threadId);throw Error("No child process or worker thread")}get exitCode(){return this._exitCode}get signalCode(){return this._signalCode}get killed(){return this.childProcess?this.childProcess.killed:this._killed}async init(){var e,t;let r,n=await G(process.execArgv);this.opts.useWorkerThreads?this.worker=r=new L.Worker(this.mainFile,Object.assign({execArgv:n,stdin:!0,stdout:!0,stderr:!0},this.opts.workerThreadsOptions?this.opts.workerThreadsOptions:{})):this.childProcess=r=(0,P.fork)(this.mainFile,[],Object.assign({execArgv:n,stdio:"pipe"},this.opts.workerForkOptions?this.opts.workerForkOptions:{})),r.on("exit",(e,t)=>{this._exitCode=e,t=void 0===t?null:t,this._signalCode=t,this._killed=!0,this.emit("exit",e,t),r.removeAllListeners(),this.removeAllListeners()}),r.on("error",(...e)=>this.emit("error",...e)),r.on("message",(...e)=>this.emit("message",...e)),r.on("close",(...e)=>this.emit("close",...e)),null==(e=r.stdout)||e.pipe(process.stdout),null==(t=r.stderr)||t.pipe(process.stderr),await this.initChild()}async send(e){return new Promise((t,r)=>{this.childProcess?this.childProcess.send(e,e=>{e?r(e):t()}):this.worker?t(this.worker.postMessage(e)):t()})}killProcess(e="SIGKILL"){this.childProcess?this.childProcess.kill(e):this.worker&&this.worker.terminate()}async kill(e="SIGKILL",t){var r;if(this.hasProcessExited())return;let n=(r=this.childProcess||this.worker,new Promise(e=>{r.once("exit",()=>e())}));if(this.killProcess(e),void 0!==t&&(0===t||isFinite(t))){let e=setTimeout(()=>{this.hasProcessExited()||this.killProcess("SIGKILL")},t);await n,clearTimeout(e)}await n}async initChild(){let e=new Promise((e,t)=>{let r=i=>{if(Object.values(E).includes(i.cmd)){if(i.cmd===E.InitCompleted)e();else if(i.cmd===E.InitFailed){let e=Error();e.stack=i.err.stack,e.message=i.err.message,t(e)}this.off("message",r),this.off("close",n)}},n=(e,i)=>{e>128&&(e-=128);let a=F[e]||`Unknown exit code ${e}`;t(Error(`Error initializing child: ${a} and signal ${i}`)),this.off("message",r),this.off("close",n)};this.on("message",r),this.on("close",n)});await this.send({cmd:K.Init,value:this.processFile}),await e}hasProcessExited(){return!!(null!==this.exitCode||this.signalCode)}}let _=async()=>new Promise(e=>{let t=(0,J.createServer)();t.listen(0,()=>{let{port:r}=t.address();t.close(()=>e(r))})}),G=async e=>{let t=[],r=[];for(let n=0;n<e.length;n++){let i=e[n];if(-1===i.indexOf("--inspect"))t.push(i);else{let e=i.split("=")[0],t=await _();r.push(`${e}=${t}`)}}return t.concat(r)};e.s(["Child",0,V],43279);var Y=e.i(14747);class ${constructor({mainFile:e=Y.join(process.cwd(),"dist/esm/classes/main.js"),useWorkerThreads:t,workerForkOptions:r,workerThreadsOptions:n}){this.retained={},this.free={},this.opts={mainFile:e,useWorkerThreads:t,workerForkOptions:r,workerThreadsOptions:n}}async retain(e){let t=this.getFree(e).pop();if(t)return this.retained[t.pid]=t,t;(t=new V(this.opts.mainFile,e,{useWorkerThreads:this.opts.useWorkerThreads,workerForkOptions:this.opts.workerForkOptions,workerThreadsOptions:this.opts.workerThreadsOptions})).on("exit",this.remove.bind(this,t));try{if(await t.init(),null!==t.exitCode||null!==t.signalCode)throw Error("Child exited before it could be retained");return this.retained[t.pid]=t,t}catch(e){if(console.error(e),t.childProcess||t.worker)try{this.kill(t,"SIGKILL").catch(e=>{console.error("Failed to kill child after init error:",e)})}catch(e){console.error("Failed to kill child after init error:",e)}throw e}}release(e){delete this.retained[e.pid],this.getFree(e.processFile).push(e)}remove(e){delete this.retained[e.pid];let t=this.getFree(e.processFile),r=t.indexOf(e);r>-1&&t.splice(r,1)}async kill(e,t="SIGKILL"){return this.remove(e),e.kill(t,3e4)}async clean(){let e=Object.values(this.retained).concat(this.getAllFree());this.retained={},this.free={},await Promise.all(e.map(e=>this.kill(e,"SIGTERM")))}getFree(e){return this.free[e]=this.free[e]||[]}getAllFree(){return Object.values(this.free).reduce((e,t)=>e.concat(t),[])}}e.s(["ChildPool",0,$],21069);var W=e.i(50245);t=globalThis.AbortController?globalThis.AbortController:W.AbortController;class U extends t{}var z=e.i(54799);let H="Connection is closed.";class B extends Error{constructor(e,t){super(null!=e?e:H),this.cause=t,this.name="ConnectionClosedError",Object.setPrototypeOf(this,new.target.prototype)}}e.s(["CONNECTION_CLOSED_ERROR_MSG",0,H,"ConnectionClosedError",0,B],28587);var Z=e.i(48680);let X={value:null};function Q(e,t,r){try{return e.apply(t,r)}catch(e){return X.value=e,X}}function ee(e){return Buffer.byteLength(e,"utf8")}function et(e){for(let t in e)if(Object.prototype.hasOwnProperty.call(e,t))return!1;return!0}function er(e){let t={};for(let r=0;r<e.length;r+=2)t[e[r]]=e[r+1];return t}function en(e){let t=[];for(let r in e)Object.prototype.hasOwnProperty.call(e,r)&&void 0!==e[r]&&(t[t.length]=r,t[t.length]=e[r]);return t}function ei(e,t){return new Promise(r=>{let n,i=()=>{null==t||t.signal.removeEventListener("abort",i),clearTimeout(n),r()};n=setTimeout(i,e),null==t||t.signal.addEventListener("abort",i)})}function ea(e,t){t.on("error",t=>{e.listenerCount("error")>0&&e.emit("error",t)})}function es(e,t){let r=e.getMaxListeners();e.setMaxListeners(r+t)}function eo(e){return Object.entries(e).reduce((e,[t,r])=>(e[r]=t,e),{})}let el={de:"deduplication",fpof:"failParentOnFailure",cpof:"continueParentOnFailure",idof:"ignoreDependencyOnFailure",kl:"keepLogs",rdof:"removeDependencyOnFailure"},ed=Object.assign({},eo(el));function ec(e){return!!e&&["connect","disconnect","duplicate"].every(t=>"function"==typeof e[t])}function eu(e){return ec(e)&&!!e.isCluster}function eh(e,t){es(e,-t)}async function ep(e,t,r=process.env.BULLMQ_TEST_PREFIX||"bull"){if(e.isCluster)return!1;let n=`${r}:${t}:*`,i=[];await new Promise((t,r)=>{let a=e.scanStream({match:n});a.on("data",t=>{if(t.length){let n=e.pipeline();t.forEach(e=>{n.del(e)});let a=n.exec().catch(e=>{throw r(e),e});i.push(a)}}),a.on("end",()=>t()),a.on("error",e=>r(e))}),await Promise.all(i);try{await e.quit()}catch(e){if(ef(e))throw e}}function em(e){if(e)return`${e.queue}:${e.id}`}let ey=/ERR unknown command ['`]\s*client\s*['`]/;function ef(e){if(e instanceof B)return!1;let{code:t,message:r}=e;return r!==H&&!r.includes("ECONNREFUSED")&&"ECONNREFUSED"!==t}let eb=(e,t)=>new Promise((r,n)=>{"function"==typeof e.send?e.send(t,e=>{e?n(e):r()}):"function"==typeof e.postMessage?r(e.postMessage(t)):r()}),eg=(e,t)=>eb(e,t),eK=(e,t,r,n="redis")=>{if(r===n){let r=Z.valid(Z.coerce(e));return Z.lt(r,t)}return!1},ev=e=>{let t={};for(let r of Object.entries(e))t[r[0]]=JSON.parse(r[1]);return t},eE=e=>{let t,r={};return Object.getOwnPropertyNames(e).forEach(function(t){r[t]=e[t]}),JSON.parse(JSON.stringify(r,((t=new WeakSet).add(e),(e,r)=>{if("object"==typeof r&&null!==r){if(t.has(r))return"[Circular]";t.add(r)}return r})))},eI=1/0,ew=e=>{if(null==e)return"";if("string"==typeof e)return e;if(Array.isArray(e))return`${e.map(e=>null==e?e:ew(e))}`;if("symbol"==typeof e||"[object Symbol]"==Object.prototype.toString.call(e))return e.toString();let t=`${e}`;return"0"===t&&1/e==-eI?"-0":t};function eS(e){let t={};for(let r in e)void 0!==e[r]&&(t[r]=e[r]);return t}async function ek(e,t,r,n,i,a,s){if(!e)return a();{let o,{tracer:l,contextManager:d}=e,c=d.active();s&&(o=d.fromMetadata(c,s));let u=i?`${n} ${i}`:n,h=l.startSpan(u,{kind:t},o);try{let e,i;return h.setAttributes({[w.QueueName]:r,[w.QueueOperation]:n}),e=t===k.CONSUMER&&o?h.setSpanOnContext(o):h.setSpanOnContext(c),2==a.length&&(i=d.getMetadata(e)),await d.with(e,()=>a(h,i))}catch(e){throw h.recordException(e),e}finally{h.end()}}}e.s(["DELAY_TIME_1",0,100,"DELAY_TIME_5",0,5e3,"QUEUE_EVENT_SUFFIX",0,":qe","array2obj",0,er,"asyncSend",0,eb,"childSend",0,eg,"clientCommandMessageReg",0,ey,"decreaseMaxListeners",0,eh,"delay",0,ei,"errorObject",0,X,"errorToJSON",0,eE,"forwardConnectionError",0,ea,"getParentKey",0,em,"increaseMaxListeners",0,es,"invertObject",0,eo,"isEmpty",0,et,"isNotConnectionError",0,ef,"isRedisCluster",0,eu,"isRedisInstance",0,ec,"isRedisVersionLowerThan",0,eK,"lengthInUtf8Bytes",0,ee,"objectToFlatArray",0,en,"optsDecodeMap",0,el,"optsEncodeMap",0,ed,"parseObjectValues",0,ev,"removeAllQueueData",0,ep,"removeUndefinedFields",0,eS,"toString",0,ew,"trace",0,ek,"tryCatch",0,Q],55170),(b=j||(j={}))[b.Idle=0]="Idle",b[b.Started=1]="Started",b[b.Terminating=2]="Terminating",b[b.Errored=3]="Errored";class ej{constructor(e,t){this.send=e,this.receiver=t}async init(e){var t;let r;try{let{default:e}=await Promise.resolve().then(()=>{let e=Error("Cannot find module as expression is too dynamic");throw e.code="MODULE_NOT_FOUND",e});if((r=e).default&&(r=r.default),"function"!=typeof r)throw Error("No function is exported in processor file")}catch(e){this.status=j.Errored;try{await this.send({cmd:E.InitFailed,err:eE(e)})}finally{process.exit(null!=(t=process.exitCode)?t:1)}}let n=r;r=function(e,t,r){try{return Promise.resolve(n(e,t,r))}catch(e){return Promise.reject(e)}},this.processor=r,this.status=j.Idle,await this.send({cmd:E.InitCompleted})}async start(e,t){if(this.status!==j.Idle)return this.send({cmd:E.Error,err:eE(Error("cannot start a not idling child process"))});this.status=j.Started,this.abortController=new U,this.currentJobPromise=(async()=>{try{let r=this.wrapJob(e,this.send),n=await this.processor(r,t,this.abortController.signal);await this.send({cmd:E.Completed,value:void 0===n?null:n})}catch(e){await this.send({cmd:E.Failed,value:eE(e.message?e:Error(e))})}finally{this.status=j.Idle,this.currentJobPromise=void 0,this.abortController=void 0}})()}cancel(e){this.abortController&&this.abortController.abort(e)}async stop(){}async waitForCurrentJobAndExit(){this.status=j.Terminating;try{await this.currentJobPromise}finally{process.exit(process.exitCode||0)}}wrapJob(e,t){let r=Object.assign(Object.assign({},e),{queueQualifiedName:e.queueQualifiedName,data:JSON.parse(e.data||"{}"),opts:e.opts,returnValue:JSON.parse(e.returnvalue||"{}"),async updateProgress(e){this.progress=e,await t({cmd:E.Progress,value:e})},log:async e=>{await t({cmd:E.Log,value:e})},moveToDelayed:async(e,r)=>{await t({cmd:E.MoveToDelayed,value:{timestamp:e,token:r}})},moveToWait:async e=>{await t({cmd:E.MoveToWait,value:{token:e}})},moveToWaitingChildren:async(e,r)=>{let n=Math.random().toString(36).substring(2,15);return await t({requestId:n,cmd:E.MoveToWaitingChildren,value:{token:e,opts:r}}),ex(n,this.receiver,5e3,"moveToWaitingChildren")},updateData:async e=>{await t({cmd:E.Update,value:e}),r.data=e},getChildrenValues:async()=>{let e=Math.random().toString(36).substring(2,15);return await t({requestId:e,cmd:E.GetChildrenValues}),ex(e,this.receiver,5e3,"getChildrenValues")},getIgnoredChildrenFailures:async()=>{let e=Math.random().toString(36).substring(2,15);return await t({requestId:e,cmd:E.GetIgnoredChildrenFailures}),ex(e,this.receiver,5e3,"getIgnoredChildrenFailures")},getDependenciesCount:async e=>{let r=Math.random().toString(36).substring(2,15);return await t({requestId:r,cmd:E.GetDependenciesCount,value:e}),ex(r,this.receiver,5e3,"getDependenciesCount")},getDependencies:async e=>{let r=Math.random().toString(36).substring(2,15);return await t({requestId:r,cmd:E.GetDependencies,value:e}),ex(r,this.receiver,5e3,"getDependencies")}});return r}}let ex=async(e,t,r,n)=>new Promise((i,a)=>{let s=r=>{r.requestId===e&&(i(r.value),t.off("message",s))};t.on("message",s),setTimeout(()=>{t.off("message",s),a(Error(`TimeoutError: ${n} timed out in (${r}ms)`))},r)});e.s(["ChildProcessor",0,ej],63126);var eD=q,eC=q;try{x=new TextDecoder}catch(e){}var eT=0;let eO=[];var eR=eO,eA=0,eM={},eN=0,eP=0,eJ=[],eL={useRecords:!1,mapsAsObjects:!0};class eq{}let eF=new eq;eF.name="MessagePack 0xC1";var eV=!1,e_=2;class eG{constructor(e){e&&(!1===e.useRecords&&void 0===e.mapsAsObjects&&(e.mapsAsObjects=!0),e.sequential&&!1!==e.trusted&&(e.trusted=!0,!e.structures&&!1!=e.useRecords&&(e.structures=[],e.maxSharedStructures||(e.maxSharedStructures=0))),e.structures?e.structures.sharedLength=e.structures.length:e.getStructures&&((e.structures=[]).uninitialized=!0,e.structures.sharedLength=0),e.int64AsNumber&&(e.int64AsType="number")),Object.assign(this,e)}unpack(e,t){if(D)return td(()=>(tc(),this?this.unpack(e,t):eG.prototype.unpack.call(eL,e,t)));e.buffer||e.constructor!==ArrayBuffer||(e="u">typeof Buffer?Buffer.from(e):new Uint8Array(e)),"object"==typeof t?(C=t.end||e.length,eT=t.start||0):(eT=0,C=t>-1?t:e.length),eA=0,eP=0,O=null,eR=eO,R=null,D=e;try{M=e.dataView||(e.dataView=new DataView(e.buffer,e.byteOffset,e.byteLength))}catch(t){if(D=null,e instanceof Uint8Array)throw t;throw Error("Source must be a Uint8Array or Buffer but was a "+(e&&"object"==typeof e?e.constructor.name:typeof e))}return this instanceof eG?(eM=this,this.structures?T=this.structures:(!T||T.length>0)&&(T=[])):(eM=eL,(!T||T.length>0)&&(T=[])),eY(t)}unpackMultiple(e,t){let r,n=0;try{eV=!0;let i=e.length,a=this?this.unpack(e,i):th.unpack(e,i);if(t){if(!1===t(a,n,eT))return;for(;eT<i;)if(n=eT,!1===t(eY(),n,eT))return}else{for(r=[a];eT<i;)n=eT,r.push(eY());return r}}catch(e){throw e.lastPosition=n,e.values=r,e}finally{eV=!1,tc()}}_mergeStructures(e,t){this._onLoadedStructures&&(e=this._onLoadedStructures(e)),Object.isFrozen(e=e||[])&&(e=e.map(e=>e.slice(0)));for(let t=0,r=e.length;t<r;t++){let r=e[t];r&&(r.isShared=!0,t>=32&&(r.highByte=t-32>>5))}for(let r in e.sharedLength=e.length,t||[])if(r>=0){let n=e[r],i=t[r];i&&(n&&((e.restoreStructures||(e.restoreStructures=[]))[r]=n),e[r]=i)}return this.structures=e}decode(e,t){return this.unpack(e,t)}}function eY(e){try{let t;if(!eM.trusted&&!eV){let e=T.sharedLength||0;e<T.length&&(T.length=e)}if(eM._readStruct&&D[eT]<64&&D[eT]>=32?(t=eM._readStruct(D,eT,C),D=null,!(e&&e.lazy)&&t&&(t=t.toJSON()),eT=C):t=eW(),R&&(eT=R.postBundlePosition,R=null),eV&&(T.restoreStructures=null),eT==C)T&&T.restoreStructures&&e$(),T=null,D=null,A&&(A=null);else if(eT>C)throw Error("Unexpected end of MessagePack data");else if(!eV){let e;try{e=JSON.stringify(t,(e,t)=>"bigint"==typeof t?`${t}n`:t).slice(0,100)}catch(t){e="(JSON view not available "+t+")"}throw Error("Data read, but end of buffer not reached "+e)}return t}catch(e){throw T&&T.restoreStructures&&e$(),tc(),(e instanceof RangeError||e.message.startsWith("Unexpected end of buffer")||eT>C)&&(e.incomplete=!0),e}}function e$(){for(let e in T.restoreStructures)T[e]=T.restoreStructures[e];T.restoreStructures=null}function eW(){let e=D[eT++];if(e<160)if(e<128)if(e<64)return e;else{let t=T[63&e]||eM.getStructures&&eB()[63&e];return t?(t.read||(t.read=ez(t,63&e)),t.read()):e}else if(e<144){if(e-=128,eM.mapsAsObjects){let t={};for(let r=0;r<e;r++){let e=tr();"__proto__"===e&&(e="__proto_"),t[e]=eW()}return t}{let t=new Map;for(let r=0;r<e;r++)t.set(eW(),eW());return t}}else{let t=Array(e-=144);for(let r=0;r<e;r++)t[r]=eW();return eM.freezeData?Object.freeze(t):t}if(e<192){let t=e-160;if(eP>=eT)return O.slice(eT-eN,(eT+=t)-eN);if(0==eP&&C<140){let e=t<16?e8(t):e5(t);if(null!=e)return e}return eZ(t)}{let t;switch(e){case 192:return null;case 193:if(R){if((t=eW())>0)return R[1].slice(R.position1,R.position1+=t);return R[0].slice(R.position0,R.position0-=t)}return eF;case 194:return!1;case 195:return!0;case 196:if(void 0===(t=D[eT++]))throw Error("Unexpected end of buffer");return e7(t);case 197:return t=M.getUint16(eT),eT+=2,e7(t);case 198:return t=M.getUint32(eT),eT+=4,e7(t);case 199:return te(D[eT++]);case 200:return t=M.getUint16(eT),eT+=2,te(t);case 201:return t=M.getUint32(eT),eT+=4,te(t);case 202:if(t=M.getFloat32(eT),eM.useFloat32>2){let e=tu[(127&D[eT])<<1|D[eT+1]>>7];return eT+=4,(e*t+(t>0?.5:-.5)|0)/e}return eT+=4,t;case 203:return t=M.getFloat64(eT),eT+=8,t;case 204:return D[eT++];case 205:return t=M.getUint16(eT),eT+=2,t;case 206:return t=M.getUint32(eT),eT+=4,t;case 207:return"number"===eM.int64AsType?t=0x100000000*M.getUint32(eT)+M.getUint32(eT+4):"string"===eM.int64AsType?t=M.getBigUint64(eT).toString():"auto"===eM.int64AsType?(t=M.getBigUint64(eT))<=BigInt(2)<<BigInt(52)&&(t=Number(t)):t=M.getBigUint64(eT),eT+=8,t;case 208:return M.getInt8(eT++);case 209:return t=M.getInt16(eT),eT+=2,t;case 210:return t=M.getInt32(eT),eT+=4,t;case 211:return"number"===eM.int64AsType?t=0x100000000*M.getInt32(eT)+M.getUint32(eT+4):"string"===eM.int64AsType?t=M.getBigInt64(eT).toString():"auto"===eM.int64AsType?(t=M.getBigInt64(eT))>=BigInt(-2)<<BigInt(52)&&t<=BigInt(2)<<BigInt(52)&&(t=Number(t)):t=M.getBigInt64(eT),eT+=8,t;case 212:if(114==(t=D[eT++]))return ti(63&D[eT++]);{let e=eJ[t];if(e)if(e.read)return eT++,e.read(eW());else if(e.noBuffer)return eT++,e();else return e(D.subarray(eT,++eT));throw Error("Unknown extension "+t)}case 213:if(114==(t=D[eT]))return eT++,ti(63&D[eT++],D[eT++]);return te(2);case 214:return te(4);case 215:return te(8);case 216:return te(16);case 217:if(t=D[eT++],eP>=eT)return O.slice(eT-eN,(eT+=t)-eN);return eX(t);case 218:if(t=M.getUint16(eT),eT+=2,eP>=eT)return O.slice(eT-eN,(eT+=t)-eN);return eQ(t);case 219:if(t=M.getUint32(eT),eT+=4,eP>=eT)return O.slice(eT-eN,(eT+=t)-eN);return e0(t);case 220:return t=M.getUint16(eT),eT+=2,e3(t);case 221:return t=M.getUint32(eT),eT+=4,e3(t);case 222:return t=M.getUint16(eT),eT+=2,e4(t);case 223:return t=M.getUint32(eT),eT+=4,e4(t);default:if(e>=224)return e-256;if(void 0===e)throw e2();throw Error("Unknown MessagePack token "+e)}}}let eU=/^[a-zA-Z_$][a-zA-Z\d_$]*$/;function ez(e,t){function r(){if(r.count++>e_){let n;try{n=e.read=Function("r","return function(){return "+(eM.freezeData?"Object.freeze":"")+"({"+e.map(e=>"__proto__"===e?"__proto_:r()":eU.test(e)?e+":r()":"["+JSON.stringify(e)+"]:r()").join(",")+"})}")(eW)}catch(e){return e_=1/0,r()}return e.read0=n,0===e.highByte&&(e.read=eH(t,e.read)),n()}let n={};for(let t=0,r=e.length;t<r;t++){let r=e[t];"__proto__"===r&&(r="__proto_"),n[r]=eW()}return eM.freezeData?Object.freeze(n):n}return(r.count=0,e.read0=r,0===e.highByte)?eH(t,r):r}let eH=(e,t)=>function(){let r=D[eT++];if(0===r)return t();let n=e<32?-(e+(r<<5)):e+(r<<5),i=T[n]||eB()[n];if(!i)throw Error("Record id is not defined for "+n);return i.read||(i.read=ez(i,e)),i.read()};function eB(){let e=td(()=>(D=null,eM.getStructures()));return T=eM._mergeStructures(e,T)}var eZ=e1,eX=e1,eQ=e1,e0=e1;function e1(e){let t;if(e<16&&(t=e8(e)))return t;if(e>64&&x)return x.decode(D.subarray(eT,eT+=e));let r=eT+e,n=[];for(t="";eT<r;){let e=D[eT++];if((128&e)==0)n.push(e);else if((224&e)==192)if(e<194||eT>=r||(192&D[eT])!=128)n.push(65533);else{let t=63&D[eT++];n.push((31&e)<<6|t)}else if((240&e)==224){let t=eT<r?D[eT]:0;if(eT>=r||(192&t)!=128||224===e&&t<160||237===e&&t>=160)n.push(65533);else if(++eT>=r||(192&D[eT])!=128)n.push(65533);else{let r=63&D[eT++];n.push((31&e)<<12|(63&t)<<6|r)}}else if((248&e)==240){let t=eT<r?D[eT]:0;if(e>244||eT>=r||(192&t)!=128||240===e&&t<144||244===e&&t>=144)n.push(65533);else if(++eT>=r||(192&D[eT])!=128)n.push(65533);else{let i=63&D[eT++];if(eT>=r||(192&D[eT])!=128)n.push(65533);else{let r=(7&e)<<18|(63&t)<<12|i<<6|63&D[eT++];r-=65536,n.push(r>>>10&1023|55296),n.push(56320|1023&r)}}}else n.push(65533);n.length>=4096&&(t+=e6.apply(String,n),n.length=0)}return n.length>0&&(t+=e6.apply(String,n)),t}function e2(){let e=Error("Unexpected end of MessagePack data");return e.incomplete=!0,e}function e3(e){if(e>C-eT)throw e2();let t=Array(e);for(let r=0;r<e;r++)t[r]=eW();return eM.freezeData?Object.freeze(t):t}function e4(e){if(e>(C-eT)/2)throw e2();if(eM.mapsAsObjects){let t={};for(let r=0;r<e;r++){let e=tr();"__proto__"===e&&(e="__proto_"),t[e]=eW()}return t}{let t=new Map;for(let r=0;r<e;r++)t.set(eW(),eW());return t}}var e6=String.fromCharCode;function e5(e){let t=eT,r=Array(e);for(let n=0;n<e;n++){let e=D[eT++];if((128&e)>0){eT=t;return}r[n]=e}return e6.apply(String,r)}function e8(e){if(e<4)if(e<2)if(0===e)return"";else{let e=D[eT++];if((128&e)>1){eT-=1;return}return e6(e)}else{let t=D[eT++],r=D[eT++];if((128&t)>0||(128&r)>0){eT-=2;return}if(e<3)return e6(t,r);let n=D[eT++];if((128&n)>0){eT-=3;return}return e6(t,r,n)}{let t=D[eT++],r=D[eT++],n=D[eT++],i=D[eT++];if((128&t)>0||(128&r)>0||(128&n)>0||(128&i)>0){eT-=4;return}if(e<6)if(4===e)return e6(t,r,n,i);else{let e=D[eT++];if((128&e)>0){eT-=5;return}return e6(t,r,n,i,e)}if(e<8){let a=D[eT++],s=D[eT++];if((128&a)>0||(128&s)>0){eT-=6;return}if(e<7)return e6(t,r,n,i,a,s);let o=D[eT++];if((128&o)>0){eT-=7;return}return e6(t,r,n,i,a,s,o)}{let a=D[eT++],s=D[eT++],o=D[eT++],l=D[eT++];if((128&a)>0||(128&s)>0||(128&o)>0||(128&l)>0){eT-=8;return}if(e<10)if(8===e)return e6(t,r,n,i,a,s,o,l);else{let e=D[eT++];if((128&e)>0){eT-=9;return}return e6(t,r,n,i,a,s,o,l,e)}if(e<12){let d=D[eT++],c=D[eT++];if((128&d)>0||(128&c)>0){eT-=10;return}if(e<11)return e6(t,r,n,i,a,s,o,l,d,c);let u=D[eT++];if((128&u)>0){eT-=11;return}return e6(t,r,n,i,a,s,o,l,d,c,u)}{let d=D[eT++],c=D[eT++],u=D[eT++],h=D[eT++];if((128&d)>0||(128&c)>0||(128&u)>0||(128&h)>0){eT-=12;return}if(e<14)if(12===e)return e6(t,r,n,i,a,s,o,l,d,c,u,h);else{let e=D[eT++];if((128&e)>0){eT-=13;return}return e6(t,r,n,i,a,s,o,l,d,c,u,h,e)}{let p=D[eT++],m=D[eT++];if((128&p)>0||(128&m)>0){eT-=14;return}if(e<15)return e6(t,r,n,i,a,s,o,l,d,c,u,h,p,m);let y=D[eT++];if((128&y)>0){eT-=15;return}return e6(t,r,n,i,a,s,o,l,d,c,u,h,p,m,y)}}}}}function e9(){let e,t=D[eT++];if(t<192)e=t-160;else switch(t){case 217:e=D[eT++];break;case 218:e=M.getUint16(eT),eT+=2;break;case 219:e=M.getUint32(eT),eT+=4;break;default:throw Error("Expected string")}return e1(e)}function e7(e){return eM.copyBuffers?Uint8Array.prototype.slice.call(D,eT,eT+=e):D.subarray(eT,eT+=e)}function te(e){let t=D[eT++];if(eJ[t]){let r;return eJ[t](D.subarray(eT,r=eT+=e),e=>{eT=e;try{return eW()}finally{eT=r}})}throw Error("Unknown extension type "+t)}var tt=Array(4096);function tr(){let e,t=D[eT++];if(!(t>=160)||!(t<192))return eT--,tn(eW());if(t-=160,eP>=eT)return O.slice(eT-eN,(eT+=t)-eN);if(!(0==eP&&C<180))return eZ(t);let r=(t<<5^(t>1?M.getUint16(eT):t>0?D[eT]:0))&4095,n=tt[r],i=eT,a=eT+t-3,s=0;if(n&&n.bytes==t){for(;i<a;){if((e=M.getUint32(i))!=n[s++]){i=0x70000000;break}i+=4}for(a+=3;i<a;)if((e=D[i++])!=n[s++]){i=0x70000000;break}if(i===a)return eT=i,n.string;a-=3,i=eT}for(n=[],tt[r]=n,n.bytes=t;i<a;)e=M.getUint32(i),n.push(e),i+=4;for(a+=3;i<a;)e=D[i++],n.push(e);let o=t<16?e8(t):e5(t);return null!=o?n.string=o:n.string=eZ(t)}function tn(e){if("string"==typeof e)return e;if("number"==typeof e||"boolean"==typeof e||"bigint"==typeof e)return e.toString();if(null==e)return e+"";if(eM.allowArraysInMapKeys&&Array.isArray(e)&&e.flat().every(e=>["string","number","boolean","bigint"].includes(typeof e)))return e.flat().toString();throw Error(`Invalid property type for record: ${typeof e}`)}let ti=(e,t)=>{let r=eW().map(tn),n=e;void 0!==t&&(e=e<32?-((t<<5)+e):(t<<5)+e,r.highByte=t);let i=T[e];return i&&(i.isShared||eV)&&((T.restoreStructures||(T.restoreStructures=[]))[e]=i),T[e]=r,r.read=ez(r,n),(r.read0||r.read)()};eJ[0]=()=>{},eJ[0].noBuffer=!0,eJ[66]=e=>{let t=e.byteLength%8||8,r=BigInt(128&e[0]?e[0]-256:e[0]);for(let n=1;n<t;n++)r<<=BigInt(8),r+=BigInt(e[n]);if(e.byteLength!==t){let n=new DataView(e.buffer,e.byteOffset,e.byteLength),i=(e,t)=>{let r=t-e;if(r<=40){let r=n.getBigUint64(e);for(let i=e+8;i<t;i+=8)r<<=BigInt(64),r|=n.getBigUint64(i);return r}let a=e+(r>>4<<3),s=i(e,a),o=i(a,t);return s<<BigInt((t-a)*8)|o};r=r<<BigInt((n.byteLength-t)*8)|i(t,n.byteLength)}return r};let ta={Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,AggregateError:"function"==typeof AggregateError?AggregateError:null};eJ[101]=()=>{let e=eW();if(!ta[e[0]]){let t=Error(e[1],{cause:e[2]});return t.name=e[0],t}return ta[e[0]](e[1],{cause:e[2]})},eJ[105]=e=>{let t;if(!1===eM.structuredClone)throw Error("Structured clone extension is disabled");let r=M.getUint32(eT-4);A||(A=new Map);let n=D[eT],i={target:t=n>=144&&n<160||220==n||221==n?[]:n>=128&&n<144||222==n||223==n?new Map:(n>=199&&n<=201||n>=212&&n<=216)&&115===D[eT+1]?new Set:{}};A.set(r,i);let a=eW();if(!i.used)return i.target=a;if(Object.assign(t,a),t instanceof Map)for(let[e,r]of a.entries())t.set(e,r);if(t instanceof Set)for(let e of Array.from(a))t.add(e);return t},eJ[112]=e=>{if(!1===eM.structuredClone)throw Error("Structured clone extension is disabled");let t=M.getUint32(eT-4),r=A.get(t);return r.used=!0,r.target},eJ[115]=()=>new Set(eW());let ts=["Int8","Uint8","Uint8Clamped","Int16","Uint16","Int32","Uint32","Float32","Float64","BigInt64","BigUint64"].map(e=>e+"Array"),to="object"==typeof globalThis?globalThis:window;eJ[116]=e=>{let t=e[0],r=Uint8Array.prototype.slice.call(e,1).buffer,n=ts[t];if(!n){if(16===t)return r;if(17===t)return new DataView(r);throw Error("Could not find typed array for code "+t)}return new to[n](r)},eJ[120]=()=>{let e=eW();return new RegExp(e[0],e[1])};let tl=[];function td(e){eM&&eM._onSaveState&&eM._onSaveState();let t=C,r=eT,n=eA,i=eN,a=eP,s=O,o=eR,l=A,d=R,c=new Uint8Array(D.slice(0,C)),u=T,h=T.slice(0,T.length),p=eM,m=eV,y=e();return C=t,eT=r,eA=n,eN=i,eP=a,O=s,eR=o,A=l,R=d,D=c,eV=m,(T=u).splice(0,T.length,...h),eM=p,M=new DataView(D.buffer,D.byteOffset,D.byteLength),y}function tc(){D=null,A=null,T=null}eJ[98]=e=>{let t=(e[0]<<24)+(e[1]<<16)+(e[2]<<8)+e[3],r=eT;return eT+=t-e.length,R=tl,(R=[e9(),e9()]).position0=0,R.position1=0,R.postBundlePosition=eT,eT=r,eW()},eJ[255]=e=>4==e.length?new Date((0x1000000*e[0]+(e[1]<<16)+(e[2]<<8)+e[3])*1e3):8==e.length?new Date(((e[0]<<22)+(e[1]<<14)+(e[2]<<6)+(e[3]>>2))/1e6+((3&e[3])*0x100000000+0x1000000*e[4]+(e[5]<<16)+(e[6]<<8)+e[7])*1e3):12==e.length?new Date(((e[0]<<24)+(e[1]<<16)+(e[2]<<8)+e[3])/1e6+((128&e[4]?-0x1000000000000:0)+0x10000000000*e[6]+0x100000000*e[7]+0x1000000*e[8]+(e[9]<<16)+(e[10]<<8)+e[11])*1e3):new Date("invalid");let tu=Array(147);for(let e=0;e<256;e++)tu[e]=+("1e"+Math.floor(45.15-.30103*e));var th=new eG({useRecords:!1});th.unpack,th.unpackMultiple,th.unpack,new Uint8Array(new Float32Array(1).buffer,0,4),eG.SUPPORTS_STRUCT_HOOKS=!0;try{r=new TextEncoder}catch(e){}let tp="u">typeof Buffer,tm=tp?function(e){return Buffer.allocUnsafeSlow(e)}:Uint8Array,ty=tp?Buffer:Uint8Array,tf=tp?0x100000000:0x7fd00000,tb=0,tg=null,tK=/[\u0080-\uFFFF]/,tv=Symbol("record-id");class tE extends eG{constructor(e){let t,d,c,u;super(e),this.offset=0;let h=ty.prototype.utf8Write?function(e,t){return a.utf8Write(e,t,a.byteLength-t)}:!!r&&!!r.encodeInto&&function(e,t){return r.encodeInto(e,a.subarray(t)).written},p=this;e||(e={});let m=e&&e.sequential,y=e.structures||e.saveStructures,f=e.maxSharedStructures;if(null==f&&(f=32*!!y),f>8160)throw Error("Maximum maxSharedStructure is 8160");e.structuredClone&&void 0==e.moreTypes&&(this.moreTypes=!0);let b=e.maxOwnStructures;null==b&&(b=y?32:64),this.structures||!1==e.useRecords||(this.structures=[]);let g=f>32||b+f>64,K=f+64,v=f+b+64;if(v>8256)throw Error("Maximum maxSharedStructure + maxOwnStructure is 8192");let E=[],I=0,w=0;this.pack=this.encode=function(e,r){let n;if(a||(o=(a=new tm(8192)).dataView||(a.dataView=new DataView(a.buffer,0,8192)),tb=0),(l=a.length-10)-tb<2048?(o=(a=new tm(a.length)).dataView||(a.dataView=new DataView(a.buffer,0,a.length)),l=a.length-10,tb=0):tb=tb+7&0x7ffffff8,t=tb,r&tA&&(tb+=255&r),u=p.structuredClone?new Map:null,p.bundleStrings&&"string"!=typeof e?(tg=[]).size=1/0:tg=null,c=p.structures){c.uninitialized&&(c=p._mergeStructures(p.getStructures()));let e=c.sharedLength||0;if(e>f)throw Error("Shared structures is larger than maximum shared structures, try increasing maxSharedStructures to "+c.sharedLength);if(!c.transitions){c.transitions=Object.create(null);for(let t=0;t<e;t++){let e=c[t];if(!e)continue;let r,n=c.transitions;for(let t=0,i=e.length;t<i;t++){let i=e[t];(r=n[i])||(r=n[i]=Object.create(null)),n=r}n[tv]=t+64}this.lastNamedStructuresLength=e}m||(c.nextId=e+64)}d&&(d=!1);try{p._writeStruct&&e&&"object"==typeof e?e.constructor===Object?O(e):e.constructor===Map||Array.isArray(e)||i.some(t=>e instanceof t)?j(e):O(!1!==p.useToJSON&&e.toJSON?e.toJSON():e):j(e);let n=tg;if(tg&&tk(t,j,0),u&&u.idsToInsert){let e=u.idsToInsert.sort((e,t)=>e.offset>t.offset?1:-1),r=e.length,i=-1;for(;n&&r>0;){let a=e[--r].offset+t;a<n.stringsPosition+t&&-1===i&&(i=0),a>n.position+t?i>=0&&(i+=6):(i>=0&&(o.setUint32(n.position+t,o.getUint32(n.position+t)+i),i=-1),n=n.previous,r++)}i>=0&&n&&o.setUint32(n.position+t,o.getUint32(n.position+t)+i),(tb+=6*e.length)>l&&R(tb),p.offset=tb;let s=function(e,t){let r,n=6*t.length,i=e.length-n;for(;r=t.pop();){let t=r.offset,a=r.id;e.copyWithin(t+n,t,i);let s=t+(n-=6);e[s++]=214,e[s++]=105,e[s++]=a>>24,e[s++]=a>>16&255,e[s++]=a>>8&255,e[s++]=255&a,i=t}return e}(a.subarray(t,tb),e);return u=null,s}if(p.offset=tb,r&tO)return a.start=t,a.end=tb,a;return a.subarray(t,tb)}catch(e){throw n=e,e}finally{if(c&&(S(),d&&p.saveStructures)){let i=c.sharedLength||0,s=a.subarray(t,tb),o=(p._prepareStructures||function(e,t){return e.isCompatible=e=>{let r=!e||(t.lastNamedStructuresLength||0)===e.length;return r||t._mergeStructures(e),r},e})(c,p);if(!n){if(!1===p.saveStructures(o,o.isCompatible))return c.uninitialized=!0,p.pack(e,r);return p.lastNamedStructuresLength=i,a.length>0x40000000&&(a=null),s}}a.length>0x40000000&&(a=null),r&tR&&(tb=t)}};const S=()=>{w<10&&w++;let e=c.sharedLength||0;if(c.length>e&&!m&&(c.length=e),I>1e4)c.transitions=null,w=0,I=0,E.length>0&&(E=[]);else if(E.length>0&&!m){for(let e=0,t=E.length;e<t;e++)E[e][tv]=0;E=[]}},k=e=>{var t=e.length;t<16?a[tb++]=144|t:t<65536?(a[tb++]=220,a[tb++]=t>>8,a[tb++]=255&t):(a[tb++]=221,o.setUint32(tb,t),tb+=4);for(let r=0;r<t;r++)j(e[r])},j=e=>{tb>l&&(a=R(tb));var r,s=typeof e;if("string"===s){let n,i=e.length;if(tg&&i>=4&&i<4096){if((tg.size+=i)>21760){let e,r,n=(tg[0]?3*tg[0].length+tg[1].length:0)+10;tb+n>l&&(a=R(tb+n)),tg.position?(r=tg,a[tb]=200,tb+=3,a[tb++]=98,e=tb-t,tb+=4,tk(t,j,0),o.setUint16(e+t-3,tb-t-e)):(a[tb++]=214,a[tb++]=98,e=tb-t,tb+=4),(tg=["",""]).previous=r,tg.size=0,tg.position=e}let r=tK.test(e);tg[+!r]+=e,a[tb++]=193,j(r?-i:i);return}n=i<32?1:i<256?2:i<65536?3:5;let s=3*i;if(tb+s>l&&(a=R(tb+s)),i<64||!h){let t,s,o,l=tb+n;for(t=0;t<i;t++)(s=e.charCodeAt(t))<128?a[l++]=s:(s<2048?a[l++]=s>>6|192:((64512&s)==55296&&(64512&(o=e.charCodeAt(t+1)))==56320?(s=65536+((1023&s)<<10)+(1023&o),t++,a[l++]=s>>18|240,a[l++]=s>>12&63|128):a[l++]=s>>12|224,a[l++]=s>>6&63|128),a[l++]=63&s|128);r=l-tb-n}else r=h(e,tb+n);r<32?a[tb++]=160|r:r<256?(n<2&&a.copyWithin(tb+2,tb+1,tb+1+r),a[tb++]=217,a[tb++]=r):r<65536?(n<3&&a.copyWithin(tb+3,tb+2,tb+2+r),a[tb++]=218,a[tb++]=r>>8,a[tb++]=255&r):(n<5&&a.copyWithin(tb+5,tb+3,tb+3+r),a[tb++]=219,o.setUint32(tb,r),tb+=4),tb+=r}else if("number"===s)if(e>>>0===e)e<32||e<128&&!1===this.useRecords||e<64&&!this._writeStruct?a[tb++]=e:e<256?(a[tb++]=204,a[tb++]=e):e<65536?(a[tb++]=205,a[tb++]=e>>8,a[tb++]=255&e):(a[tb++]=206,o.setUint32(tb,e),tb+=4);else if((0|e)===e)e>=-32?a[tb++]=256+e:e>=-128?(a[tb++]=208,a[tb++]=e+256):e>=-32768?(a[tb++]=209,o.setInt16(tb,e),tb+=2):(a[tb++]=210,o.setInt32(tb,e),tb+=4);else{let t;if((t=this.useFloat32)>0&&e<0x100000000&&e>=-0x80000000){let r;if(a[tb++]=202,o.setFloat32(tb,e),t<4||(0|(r=e*tu[(127&a[tb])<<1|a[tb+1]>>7]))===r){tb+=4;return}tb--}a[tb++]=203,o.setFloat64(tb,e),tb+=8}else if("object"===s||"function"===s)if(e){if(u){let r=u.get(e);if(r){r.id||(r.id=(u.idsToInsert||(u.idsToInsert=[])).push(r)),a[tb++]=214,a[tb++]=112,o.setUint32(tb,r.id),tb+=4;return}u.set(e,{offset:tb-t})}let d=e.constructor;if(d===Object)T(e);else if(d===Array)k(e);else if(d===Map)if(this.mapAsEmptyObject)a[tb++]=128;else for(let[t,n]of((r=e.size)<16?a[tb++]=128|r:r<65536?(a[tb++]=222,a[tb++]=r>>8,a[tb++]=255&r):(a[tb++]=223,o.setUint32(tb,r),tb+=4),e))j(t),j(n);else{for(let t=0,r=n.length;t<r;t++)if(e instanceof i[t]){let r,i=n[t];if(i.write){i.type&&(a[tb++]=212,a[tb++]=i.type,a[tb++]=0);let t=i.write.call(this,e);t===e?Array.isArray(e)?k(e):T(e):j(t);return}let s=a,d=o,c=tb;a=null;try{r=i.pack.call(this,e,e=>(a=s,s=null,(tb+=e)>l&&R(tb),{target:a,targetView:o,position:tb-e}),j)}finally{s&&(a=s,o=d,tb=c,l=a.length-10)}r&&(r.length+tb>l&&R(r.length+tb),tb=tS(r,a,tb,i.type));return}if(Array.isArray(e))k(e);else{if(!1!==p.useToJSON&&e.toJSON){let t=e.toJSON();if(t!==e)return j(t)}if("function"===s)return j(this.writeFunction&&this.writeFunction(e));T(e)}}}else a[tb++]=192;else if("boolean"===s)a[tb++]=e?195:194;else if("bigint"===s){if(e<0x8000000000000000&&e>=-0x8000000000000000)a[tb++]=211,o.setBigInt64(tb,e);else if(e<0xffffffffffffffff&&e>0)a[tb++]=207,o.setBigUint64(tb,e);else if(this.largeBigIntToFloat)a[tb++]=203,o.setFloat64(tb,Number(e));else if(this.largeBigIntToString)return j(e.toString());else if(this.useBigIntExtension||this.moreTypes){let t,r=e<0?BigInt(-1):BigInt(0);if(e>>BigInt(65536)===r){let n=BigInt(0xffffffffffffffff)-BigInt(1),i=[];for(;i.push(e&n),e>>BigInt(63)!==r;)e>>=BigInt(64);(t=new Uint8Array(new BigUint64Array(i).buffer)).reverse()}else{let r=e<0,n=(r?~e:e).toString(16);if(n.length%2?n="0"+n:parseInt(n.charAt(0),16)>=8&&(n="00"+n),tp)t=Buffer.from(n,"hex");else{t=new Uint8Array(n.length/2);for(let e=0;e<t.length;e++)t[e]=parseInt(n.slice(2*e,2*e+2),16)}if(r)for(let e=0;e<t.length;e++)t[e]=~t[e]}t.length+tb>l&&R(t.length+tb),tb=tS(t,a,tb,66);return}else throw RangeError(e+" was too large to fit in MessagePack 64-bit integer format, use useBigIntExtension, or set largeBigIntToFloat to convert to float-64, or set largeBigIntToString to convert to string");tb+=8}else if("undefined"===s)this.encodeUndefinedAsNil?a[tb++]=192:(a[tb++]=212,a[tb++]=0,a[tb++]=0);else throw Error("Unknown type: "+s)},x=this.variableMapSize||this.coercibleKeyAsNumber||this.skipValues?e=>{let t,r;if(this.skipValues)for(let r in t=[],e)("function"!=typeof e.hasOwnProperty||e.hasOwnProperty(r))&&!this.skipValues.includes(e[r])&&t.push(r);else t=Object.keys(e);let n=t.length;if(n<16?a[tb++]=128|n:n<65536?(a[tb++]=222,a[tb++]=n>>8,a[tb++]=255&n):(a[tb++]=223,o.setUint32(tb,n),tb+=4),this.coercibleKeyAsNumber)for(let i=0;i<n;i++){let n=Number(r=t[i]);j(isNaN(n)?r:n),j(e[r])}else for(let i=0;i<n;i++)j(r=t[i]),j(e[r])}:e=>{a[tb++]=222;let r=tb-t;tb+=2;let n=0;for(let t in e)("function"!=typeof e.hasOwnProperty||e.hasOwnProperty(t))&&(j(t),j(e[t]),n++);if(n>65535)throw Error('Object is too large to serialize with fast 16-bit map size, use the "variableMapSize" option to serialize this object');a[r+++t]=n>>8,a[r+t]=255&n},D=!1===this.useRecords?x:e.progressiveRecords&&!g?e=>{let r,n,i=c.transitions||(c.transitions=Object.create(null)),s=tb++-t;for(let a in e)if("function"!=typeof e.hasOwnProperty||e.hasOwnProperty(a)){if(n=i[a])i=n;else{let o=Object.keys(e),l=i;i=c.transitions;let d=0;for(let e=0,t=o.length;e<t;e++){let t=o[e];!(n=i[t])&&(n=i[t]=Object.create(null),d++),i=n}s+t+1==tb?(tb--,A(i,o,d)):M(i,o,s,d),r=!0,i=l[a]}j(e[a])}if(!r){let r=i[tv];r?a[s+t]=r:M(i,Object.keys(e),s,0)}}:e=>{let t,r=c.transitions||(c.transitions=Object.create(null)),n=0;for(let i in e)("function"!=typeof e.hasOwnProperty||e.hasOwnProperty(i))&&(!(t=r[i])&&(t=r[i]=Object.create(null),n++),r=t);let i=r[tv];for(let t in i?i>=96&&g?(a[tb++]=(31&(i-=96))+96,a[tb++]=i>>5):a[tb++]=i:A(r,r.__keys__||Object.keys(e),n),e)("function"!=typeof e.hasOwnProperty||e.hasOwnProperty(t))&&j(e[t])},C="function"==typeof this.useRecords&&this.useRecords,T=C?e=>{C(e)?D(e):x(e)}:D,O=e=>{let r=p._writeStruct(e,a,t,tb,c,R,(e,t,r)=>{if(r)return d=!0;tb=t;let n=a;return(j(e),S(),n!==a)?{position:tb,targetView:o,target:a}:tb});if(0===r)return T(e);tb=r},R=e=>{let r;if(e>0x1000000){if(e-t>tf)throw Error("Packed buffer would be larger than maximum buffer size");r=Math.min(tf,4096*Math.round(Math.max((e-t)*(e>0x4000000?1.25:2),4194304)/4096))}else r=(Math.max(e-t<<2,a.length-1)>>12)+1<<12;let n=new tm(r);return o=n.dataView||(n.dataView=new DataView(n.buffer,0,r)),e=Math.min(e,a.length),a.copy?a.copy(n,0,t,e):n.set(a.slice(t,e)),tb-=t,t=0,l=n.length-10,a=n},A=(e,t,r)=>{let n=c.nextId;n||(n=64),n<K&&this.shouldShareStructure&&!this.shouldShareStructure(t)?((n=c.nextOwnId)<v||(n=K),c.nextOwnId=n+1):(n>=v&&(n=K),c.nextId=n+1);let i=t.highByte=n>=96&&g?n-96>>5:-1;e[tv]=n,e.__keys__=t,c[n-64]=t,n<K?(t.isShared=!0,c.sharedLength=n-63,d=!0,i>=0?(a[tb++]=(31&n)+96,a[tb++]=i):a[tb++]=n):(i>=0?(a[tb++]=213,a[tb++]=114,a[tb++]=(31&n)+96,a[tb++]=i):(a[tb++]=212,a[tb++]=114,a[tb++]=n),r&&(I+=w*r),E.length>=b&&(E.shift()[tv]=0),E.push(e),j(t))},M=(e,r,n,i)=>{let o=a,d=tb,c=l,u=t;tb=0,t=0,(a=s)||(s=a=new tm(8192)),l=a.length-10,A(e,r,i),s=a;let h=tb;if(a=o,tb=d,l=c,t=u,h>1){let e=tb+h-1;e>l&&R(e);let r=n+t;a.copyWithin(r+h,r+1,tb),a.set(s.slice(0,h),r),tb=e}else a[n+t]=s[0]}}useBuffer(e){(a=e).dataView||(a.dataView=new DataView(a.buffer,a.byteOffset,a.byteLength)),o=a.dataView,tb=0}set position(e){tb=e}get position(){return tb}clearSharedData(){this.structures&&(this.structures=[]),this.typedStructs&&(this.typedStructs=[])}}function tI(e,t,r,n){let i=e.byteLength;if(i+1<256){var{target:a,position:s}=r(4+i);a[s++]=199,a[s++]=i+1}else if(i+1<65536){var{target:a,position:s}=r(5+i);a[s++]=200,a[s++]=i+1>>8,a[s++]=i+1&255}else{var{target:a,position:s,targetView:o}=r(7+i);a[s++]=201,o.setUint32(s,i+1),s+=4}a[s++]=116,a[s++]=t,e.buffer||(e=new Uint8Array(e)),a.set(new Uint8Array(e.buffer,e.byteOffset,e.byteLength),s)}function tw(e,t){let r=e.byteLength;if(r<256){var n,i,{target:n,position:i}=t(r+2);n[i++]=196,n[i++]=r}else if(r<65536){var{target:n,position:i}=t(r+3);n[i++]=197,n[i++]=r>>8,n[i++]=255&r}else{var{target:n,position:i,targetView:a}=t(r+5);n[i++]=198,a.setUint32(i,r),i+=4}n.set(e,i)}function tS(e,t,r,n){let i=e.length;switch(i){case 1:t[r++]=212;break;case 2:t[r++]=213;break;case 4:t[r++]=214;break;case 8:t[r++]=215;break;case 16:t[r++]=216;break;default:i<256?(t[r++]=199,t[r++]=i):(i<65536?(t[r++]=200,t[r++]=i>>8):(t[r++]=201,t[r++]=i>>24,t[r++]=i>>16&255,t[r++]=i>>8&255),t[r++]=255&i)}return t[r++]=n,t.set(e,r),r+=i}function tk(e,t,r){if(tg.length>0){o.setUint32(tg.position+e,tb+r-tg.position-e),tg.stringsPosition=tb-e;let n=tg;tg=null,t(n[0]),t(n[1])}}i=[Date,Set,Error,RegExp,ArrayBuffer,Object.getPrototypeOf(Uint8Array.prototype).constructor,DataView,eq],n=[{pack(e,t,r){let n=e.getTime()/1e3;if((this.useTimestamp32||0===e.getMilliseconds())&&n>=0&&n<0x100000000){let{target:e,targetView:r,position:i}=t(6);e[i++]=214,e[i++]=255,r.setUint32(i,n)}else if(n>0&&n<0x100000000){let{target:r,targetView:i,position:a}=t(10);r[a++]=215,r[a++]=255,i.setUint32(a,4e6*e.getMilliseconds()+(n/1e3/0x100000000|0)),i.setUint32(a+4,n)}else if(isNaN(n)){if(this.onInvalidDate)return t(0),r(this.onInvalidDate());let{target:e,targetView:n,position:i}=t(3);e[i++]=212,e[i++]=255,e[i++]=255}else{let{target:r,targetView:i,position:a}=t(15);r[a++]=199,r[a++]=12,r[a++]=255,i.setUint32(a,1e6*e.getMilliseconds()),i.setBigInt64(a+4,BigInt(Math.floor(n)))}}},{pack(e,t,r){if(this.setAsEmptyObject)return t(0),r({});let n=Array.from(e),{target:i,position:a}=t(3*!!this.moreTypes);this.moreTypes&&(i[a++]=212,i[a++]=115,i[a++]=0),r(n)}},{pack(e,t,r){let{target:n,position:i}=t(3*!!this.moreTypes);this.moreTypes&&(n[i++]=212,n[i++]=101,n[i++]=0),r([e.name,e.message,e.cause])}},{pack(e,t,r){let{target:n,position:i}=t(3*!!this.moreTypes);this.moreTypes&&(n[i++]=212,n[i++]=120,n[i++]=0),r([e.source,e.flags])}},{pack(e,t){this.moreTypes?tI(e,16,t):tw(tp?Buffer.from(e):new Uint8Array(e),t)}},{pack(e,t){let r=e.constructor;r!==ty&&this.moreTypes?tI(e,ts.indexOf(r.name),t):tw(e,t)}},{pack(e,t){this.moreTypes?tI(e,17,t):tw(tp?Buffer.from(e):new Uint8Array(e),t)}},{pack(e,t){let{target:r,position:n}=t(1);r[n]=193}}],tE.SUPPORTS_STRUCT_HOOKS=!0;let tj=new tE({useRecords:!1});tj.pack,tj.pack;let{NEVER:tx,ALWAYS:tD,DECIMAL_ROUND:tC,DECIMAL_FIT:tT}={NEVER:0,ALWAYS:1,DECIMAL_ROUND:3,DECIMAL_FIT:4},tO=512,tR=1024,tA=2048;var tM=e.i(88947);if(tM.Transform,tM.Transform,e.i(62562),void 0===process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED||"true"!==process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED.toLowerCase()){let t;try{(t=e.r(70156))&&function(e){function t(t){return function(r){let n=eR[eA++];if(null==n){if(R)return e1(r);let i=D.byteOffset,a=e(eT-t+i,C+i,D.buffer);if("string"==typeof a)n=a,eR=eO;else if(eA=1,eP=1,void 0===(n=(eR=a)[0]))throw Error("Unexpected end of buffer")}let i=n.length;return i<=r?(eT+=r,n):(O=n,eN=eT,eP=eT+i,eT+=r,n.slice(0,r))}}eZ=t(1),eX=t(2),eQ=t(3),e0=t(5)}(t.extractStrings)}catch(e){}}let tN="6.3.6",tP="bullmq:unrecoverable";class tJ extends Error{constructor(e=tP){super(e),this.name=this.constructor.name,Object.setPrototypeOf(this,new.target.prototype)}}function tL({code:e,jobId:t,parentKey:r,command:n,state:i}){let a;switch(e){case v.JobNotExist:a=Error(`Missing key for job ${t}. ${n}`);break;case v.JobLockNotExist:a=Error(`Missing lock for job ${t}. ${n}`);break;case v.JobNotInState:a=Error(`Job ${t} is not in the ${i} state. ${n}`);break;case v.JobPendingChildren:a=Error(`Job ${t} has pending dependencies. ${n}`);break;case v.ParentJobNotExist:a=Error(`Missing key for parent job ${r}. ${n}`);break;case v.JobLockMismatch:a=Error(`Lock mismatch for job ${t}. Cmd ${n} from ${i}`);break;case v.ParentJobCannotBeReplaced:a=Error(`The parent job ${r} cannot be replaced. ${n}`);break;case v.JobBelongsToJobScheduler:a=Error(`Job ${t} belongs to a job scheduler and cannot be removed directly. ${n}`);break;case v.JobHasFailedChildren:a=new tJ(`Cannot complete job ${t} because it has at least one failed child. ${n}`);break;case v.SchedulerJobIdCollision:a=Error(`Cannot create job scheduler iteration - job ID already exists. ${n}`);break;case v.SchedulerJobSlotsBusy:a=Error(`Cannot create job scheduler iteration - current and next time slots already have jobs. ${n}`);break;default:a=Error(`Unknown code ${e} error for ${t}. ${n}`)}return a.code=e,a}e.s(["UNRECOVERABLE_ERROR",0,tP,"UnrecoverableError",0,tJ],38626);class tq{constructor(e="bull"){this.prefix=e}getKeys(e){let t={};return["","active","wait","waiting-children","paused","id","delayed","prioritized","stalled-check","completed","failed","stalled","repeat","limiter","meta","events","pc","marker","de"].forEach(r=>{t[r]=this.toKey(e,r)}),t}toKey(e,t){return`${this.getQueueQualifiedName(e)}:${t}`}getQueueQualifiedName(e){return`${this.prefix}:${e}`}}e.s(["QueueKeys",0,tq],71189);let tF=new tE({useRecords:!1,encodeUndefinedAsNil:!0}).pack;function tV(e){return"ready"===e.status||"connect"===e.status&&eu(e)}async function t_(e,t,r){tV(t)||await r(),tV(t)&&(await e.disconnect(!0),await r())}class tG extends eC.EventEmitter{constructor(e,t,r,n,i,a,s=!0){var o;super(),this.connection=e,this.name=t,this.blockingConnection=a,this.ownsConnection=s,this.version=tN,this.redisPrefix=null!=(o=i.prefix)?o:"bull";const l=this;this.queue={keys:r,toKey:n,opts:i,get closing(){return l.closing},get client(){return l.connection.client},get blockingClient(){var d;return null==(d=l.blockingConnection)?void 0:d.client},get redisVersion(){return l.connection.redisVersion},get databaseType(){return l.connection.databaseType}},this.moveToFinishedKeys=[r.wait,r.active,r.prioritized,r.events,r.stalled,r.limiter,r.delayed,r.paused,r.meta,r.pc,void 0,void 0,void 0,void 0],this.ownsConnection&&this.forwardConnectionEvents()}forQueue(e,t){let r=null!=t?t:this.redisPrefix,n=new tq(r);return new tG(this.connection,e,n.getKeys(e),t=>n.toKey(e,t),Object.assign(Object.assign({},this.queue.opts),{prefix:r}),this.blockingConnection,!1)}get qualifiedName(){return`${this.redisPrefix}:${this.name}`}get keys(){return this.queue.keys}toKey(e){return this.queue.toKey(e)}parseNodeKey(e){let t=e.lastIndexOf(":"),r=e.lastIndexOf(":",t-1);if(-1===t||-1===r){let[t="",r="",n=""]=e.split(":");return{prefix:t,queueName:r,id:n}}let n=e.slice(0,r);return{prefix:n,queueName:e.slice(r+1,t),id:e.slice(t+1)}}clientName(e=""){let t=Buffer.from(this.name).toString("base64");return`${this.redisPrefix}:${t}${e}`}forwardConnectionEvents(){this.connection.on("error",e=>this.emit("error",e)),this.connection.on("ready",()=>this.emit("ready")),this.connection.on("close",()=>this.emit("close")),this.blockingConnection&&(this.blockingConnection.on("error",e=>this.emit("error",e)),this.blockingConnection.on("ready",()=>this.emit("ready")))}async waitUntilReady(){await this.connection.client,this.blockingConnection&&await this.blockingConnection.client}async close(e=!1){if(this.ownsConnection)return this.closing||(this.closing=(async()=>{this.blockingConnection&&await this.blockingConnection.close(e),await this.connection.close(e)})()),this.closing}async disconnect(){this.ownsConnection&&(await this.connection.disconnect(),this.blockingConnection&&await this.blockingConnection.disconnect())}async setName(e){let t=await this.connection.client;try{await t.clientSetName(e)}catch(e){if(!ey.test(e.message)&&!this.closing)throw e}}get client(){return this.connection.client}get blockingClient(){var e;return null==(e=this.blockingConnection)?void 0:e.client}get redisVersion(){return this.connection.redisVersion}get databaseType(){return this.connection.databaseType}get minimumBlockTimeout(){var e;return(null!=(e=this.blockingConnection)?e:this.connection).capabilities.canBlockFor1Ms?.001:.002}get maximumBlockTimeout(){return 10}async disconnectBlocking(e=!0){this.blockingConnection&&await this.blockingConnection.disconnect(e)}async reconnectBlocking(){this.blockingConnection&&await this.blockingConnection.reconnect()}execCommand(e,t,r){let n=`${t}:${this.version}`;return e.runCommand(n,r)}async isJobInState(e,t){let r=await this.queue.client;if("waiting"===e)return await this.isJobInState("wait",t)||await this.isJobInState("paused",t);if("wait"===e||"active"===e||"paused"===e){let n=this.queue.toKey(e);return Number.isInteger(eK(this.queue.redisVersion,"6.0.6",this.queue.databaseType)?await this.execCommand(r,"isJobInList",[n,t]):await r.lpos(n,t))}if("prioritized"===e||"completed"===e||"failed"===e||"delayed"===e||"waiting-children"===e)return null!==await r.zscore(this.queue.toKey(e),t);throw Error(`Unknown job state: ${e}`)}addDelayedJobArgs(e,t,r,n=this.queue.keys){let i=[n.marker,n.meta,n.id,n.delayed,n.completed,n.events];return i.push(tF(r),e.data,t),i}addDelayedJob(e,t,r,n,i=this.queue.keys){let a=this.addDelayedJobArgs(t,r,n,i);return this.execCommand(e,"addDelayedJob",a)}addPrioritizedJobArgs(e,t,r,n=this.queue.keys){let i=[n.marker,n.meta,n.id,n.prioritized,n.delayed,n.completed,n.active,n.events,n.pc];return i.push(tF(r),e.data,t),i}addPrioritizedJob(e,t,r,n,i=this.queue.keys){let a=this.addPrioritizedJobArgs(t,r,n,i);return this.execCommand(e,"addPrioritizedJob",a)}addParentJobArgs(e,t,r,n=this.queue.keys){let i=[n.meta,n.id,n.delayed,n["waiting-children"],n.completed,n.events];return i.push(tF(r),e.data,t),i}addParentJob(e,t,r,n,i=this.queue.keys){let a=this.addParentJobArgs(t,r,n,i);return this.execCommand(e,"addParentJob",a)}addStandardJobArgs(e,t,r,n=this.queue.keys){let i=[n.wait,n.paused,n.meta,n.id,n.completed,n.delayed,n.active,n.events,n.marker];return i.push(tF(r),e.data,t),i}addStandardJob(e,t,r,n,i=this.queue.keys){let a=this.addStandardJobArgs(t,r,n,i);return this.execCommand(e,"addStandardJob",a)}async addJobToTransaction(e,t,r,n={},i=this.queue.keys){let a,s=t.opts,o=t.parent,l=[i[""],void 0!==r?r:"",t.name,t.timestamp,t.parentKey||null,n.parentDependenciesKey||null,o,t.repeatJobKey,t.deduplicationId?`${i.de}:${t.deduplicationId}`:null],d=tF(tW(s));if((a=n.addToWaitingChildren?await this.addParentJob(e,t,d,l,i):"number"==typeof s.delay&&s.delay>0?await this.addDelayedJob(e,t,d,l,i):s.priority?await this.addPrioritizedJob(e,t,d,l,i):await this.addStandardJob(e,t,d,l,i))<0)throw this.finishedErrors({code:a,parentKey:n.parentKey,command:"addJob"});return a}async addJob(e,t,r={}){let n=await this.queue.client;return this.addJobToTransaction(n,e,t,r)}async addJobs(e){let t=(await this.queue.client).pipeline();for(let r of e)this.addJobToTransaction(t,r.job,r.jobId,r.parentKeyOpts);let r=await t.exec(),n=[];for(let[e,t]of r){if(e)throw e;n.push(t)}return n}async addFlow(e){let t=(await this.queue.client).multi();for(let r of e){let e=new tq(r.prefix).getKeys(r.queueName);await this.addJobToTransaction(t,r.jobData,r.jobId,r.parentKeyOpts,e)}return await t.exec()}pauseArgs(e,t=!0){let r="wait",n="paused";e||(r="paused",n="wait");let i=[r,n,"meta","prioritized"].map(e=>this.queue.toKey(e));return i.push(this.queue.keys.events,this.queue.keys.delayed,this.queue.keys.marker),i.concat([e?"paused":"resumed",t?"1":"0"])}async pause(e){let t=await this.queue.client;if(e){let e=this.pauseArgs(!0);await this.execCommand(t,"pause",e);return}let r=0,n=!0;do{let e=this.pauseArgs(!1,n);r=Number(await this.execCommand(t,"pause",e)),n=!1}while(r>0)}async removeDeduplicationKey(e,t){let r=await this.queue.client,n=this.queue.keys,i=[`${n.de}:${e}`];return this.execCommand(r,"removeDeduplicationKey",i.concat([t]))}async addJobScheduler(e,t,r,n,i,a,s){let o=await this.queue.client,l=this.queue.keys,d=[l.repeat,l.delayed,l.wait,l.paused,l.meta,l.prioritized,l.marker,l.id,l.events,l.pc,l.active],c=[t,tF(i),e,r,tF(tW(n)),tF(tW(a)),Date.now(),l[""],s?this.queue.toKey(s):""],u=await this.execCommand(o,"addJobScheduler",d.concat(c));if("number"==typeof u&&u<0)throw this.finishedErrors({code:u,command:"addJobScheduler"});return u}async updateJobSchedulerNextMillis(e,t,r,n,i){let a=await this.queue.client,s=this.queue.keys,o=[s.repeat,s.delayed,s.wait,s.paused,s.meta,s.prioritized,s.marker,s.id,s.events,s.pc,i?this.queue.toKey(i):"",s.active],l=[t,e,r,tF(tW(n)),Date.now(),s[""],i];return this.execCommand(a,"updateJobScheduler",o.concat(l))}async removeJobScheduler(e){let t=await this.queue.client,r=this.queue.keys,n=[r.repeat,r.delayed,r.events],i=[e,r[""]];return this.execCommand(t,"removeJobScheduler",n.concat(i))}removeArgs(e,t){let r=[e,"repeat"].map(e=>this.queue.toKey(e)),n=[e,+!!t,this.queue.toKey("")];return r.concat(n)}async remove(e,t){let r=await this.queue.client,n=this.removeArgs(e,t),i=await this.execCommand(r,"removeJob",n);if(i<0)throw this.finishedErrors({code:i,jobId:e,command:"removeJob"});return i}async removeUnprocessedChildren(e){let t=await this.queue.client,r=[this.queue.toKey(e),this.queue.keys.meta,this.queue.toKey(""),e];await this.execCommand(t,"removeUnprocessedChildren",r)}async extendLock(e,t,r,n){n=n||await this.queue.client;let i=[this.queue.toKey(e)+":lock",this.queue.keys.stalled,t,r,e];return this.execCommand(n,"extendLock",i)}async extendLocks(e,t,r){let n=await this.queue.client,i=[this.queue.keys.stalled,this.queue.toKey(""),tF(t),tF(e),r];return this.execCommand(n,"extendLocks",i)}async updateData(e,t){let r=await this.queue.client,n=[this.queue.toKey(e.id)],i=JSON.stringify(t),a=await this.execCommand(r,"updateData",n.concat([i]));if(a<0)throw this.finishedErrors({code:a,jobId:e.id,command:"updateData"})}async updateProgress(e,t){let r=await this.queue.client,n=[this.queue.toKey(e),this.queue.keys.events,this.queue.keys.meta],i=JSON.stringify(t),a=await this.execCommand(r,"updateProgress",n.concat([e,i]));if(a<0)throw this.finishedErrors({code:a,jobId:e,command:"updateProgress"})}async addLog(e,t,r){let n=await this.queue.client,i=[this.queue.toKey(e),this.queue.toKey(e)+":logs"],a=await this.execCommand(n,"addLog",i.concat([e,t,r||""]));if(a<0)throw this.finishedErrors({code:a,jobId:e,command:"addLog"});return a}moveToFinishedArgs(e,t,r,n,i,a,s,o=!0,l){var d,c,u,h,p,m,y;let f=this.queue.keys,b=this.queue.opts,g="completed"===i?b.removeOnComplete:b.removeOnFail,K=this.queue.toKey(`metrics:${i}`),v=this.moveToFinishedKeys;v[10]=f[i],v[11]=this.queue.toKey(null!=(d=e.id)?d:""),v[12]=K,v[13]=this.queue.keys.marker;let E=this.getKeepJobs(n,g),I=[e.id,s,r,void 0===t?"null":t,i,!o||this.queue.closing?0:1,f[""],tF({token:a,name:b.name,keepJobs:E,limiter:b.limiter,lockDuration:b.lockDuration,attempts:e.opts.attempts,maxMetricsSize:(null==(c=b.metrics)?void 0:c.maxDataPoints)?null==(u=b.metrics)?void 0:u.maxDataPoints:"",fpof:!!(null==(h=e.opts)?void 0:h.failParentOnFailure),cpof:!!(null==(p=e.opts)?void 0:p.continueParentOnFailure),idof:!!(null==(m=e.opts)?void 0:m.ignoreDependencyOnFailure),rdof:!!(null==(y=e.opts)?void 0:y.removeDependencyOnFailure)}),l?tF(en(l)):void 0];return v.concat(I)}getKeepJobs(e,t){return void 0===e?t||{count:e?0:-1}:"object"==typeof e?e:"number"==typeof e?{count:e}:{count:e?0:-1}}async moveToFinished(e,t){let r=await this.queue.client,n=await this.execCommand(r,"moveToFinished",t);if(n<0)throw this.finishedErrors({code:n,jobId:e,command:"moveToFinished",state:"active"});if(void 0!==n)return tY(n)}drainArgs(e){let t=this.queue.keys;return[t.wait,t.paused,t.delayed,t.prioritized,t.repeat].concat([t[""],e?"1":"0"])}async drain(e){let t=await this.queue.client,r=this.drainArgs(e);return this.execCommand(t,"drain",r)}removeChildDependencyArgs(e,t){return[this.queue.keys[""]].concat([this.queue.toKey(e),t])}async removeChildDependency(e,t){let r=await this.queue.client,n=this.removeChildDependencyArgs(e,t),i=await this.execCommand(r,"removeChildDependency",n);switch(i){case 0:return!0;case 1:return!1;default:throw this.finishedErrors({code:i,jobId:e,parentKey:t,command:"removeChildDependency"})}}getRangesArgs(e,t,r,n){let i=this.queue.keys,a=e.map(e=>"waiting"===e?"wait":e);return[i[""]].concat([t,r,n?"1":"0",...a])}async getRanges(e,t=0,r=1,n=!1){let i=await this.queue.client,a=this.getRangesArgs(e,t,r,n);return await this.execCommand(i,"getRanges",a)}getJobsArgs(e,t,r,n){let i=this.queue.keys,a=[...new Set(e.map(e=>"waiting"===e?"wait":e))];return[i[""]].concat([t,r,n?"1":"0",5,...a])}async getJobs(e,t=0,r=-1,n=!1){let i=await this.queue.client,a=this.getJobsArgs(e,t,r,n);return await this.execCommand(i,"getJobs",a)}getCountsArgs(e){let t=this.queue.keys,r=e.map(e=>"waiting"===e?"wait":e);return[t[""]].concat([...r])}async getCounts(e){let t=await this.queue.client,r=this.getCountsArgs(e);return await this.execCommand(t,"getCounts",r)}getCountsPerPriorityArgs(e){return[this.queue.keys.wait,this.queue.keys.prioritized].concat(e)}async getCountsPerPriority(e){let t=await this.queue.client,r=this.getCountsPerPriorityArgs(e);return await this.execCommand(t,"getCountsPerPriority",r)}getDependencyCountsArgs(e,t){return[`${e}:processed`,`${e}:dependencies`,`${e}:failed`,`${e}:unsuccessful`].map(e=>this.queue.toKey(e)).concat(t)}async getDependencyCounts(e,t){let r=await this.queue.client,n=this.getDependencyCountsArgs(e,t);return await this.execCommand(r,"getDependencyCounts",n)}moveToCompletedArgs(e,t,r,n,i=!1){let a=Date.now();return this.moveToFinishedArgs(e,t,"returnvalue",r,"completed",n,a,i)}moveToFailedArgs(e,t,r,n,i=!1,a){let s=Date.now();return this.moveToFinishedArgs(e,t,"failedReason",r,"failed",n,s,i,a)}async isFinished(e,t=!1){let r=await this.queue.client,n=["completed","failed",e].map(e=>this.queue.toKey(e));return this.execCommand(r,"isFinished",n.concat([e,t?"1":""]))}async getState(e){let t=await this.queue.client,r=["completed","failed","delayed","active","wait","paused","waiting-children","prioritized"].map(e=>this.queue.toKey(e));return eK(this.queue.redisVersion,"6.0.6",this.queue.databaseType)?this.execCommand(t,"getState",r.concat([e])):this.execCommand(t,"getStateV2",r.concat([e]))}async changeDelay(e,t){let r=await this.queue.client,n=this.changeDelayArgs(e,t),i=await this.execCommand(r,"changeDelay",n);if(i<0)throw this.finishedErrors({code:i,jobId:e,command:"changeDelay",state:"delayed"})}changeDelayArgs(e,t){let r=Date.now();return[this.queue.keys.delayed,this.queue.keys.meta,this.queue.keys.marker,this.queue.keys.events].concat([t,JSON.stringify(r),e,this.queue.toKey(e)])}async changePriority(e,t=0,r=!1){let n=await this.queue.client,i=this.changePriorityArgs(e,t,r),a=await this.execCommand(n,"changePriority",i);if(a<0)throw this.finishedErrors({code:a,jobId:e,command:"changePriority"})}changePriorityArgs(e,t=0,r=!1){return[this.queue.keys.wait,this.queue.keys.paused,this.queue.keys.meta,this.queue.keys.prioritized,this.queue.keys.active,this.queue.keys.pc,this.queue.keys.marker].concat([t,this.queue.toKey(""),e,+!!r])}moveToDelayedArgs(e,t,r,n,i={}){let a=this.queue.keys,s=this.queue.opts,o=[a.marker,a.active,a.prioritized,a.delayed,this.queue.toKey(e),a.events,a.meta,a.stalled,a.wait,a.limiter,a.pc],l=i.fetchNext&&!this.queue.closing?1:0;return o.concat([this.queue.keys[""],t,e,r,n,i.skipAttempt?"1":"0",i.fieldsToUpdate?tF(en(i.fieldsToUpdate)):void 0,l,l?tF({token:r,lockDuration:s.lockDuration,limiter:s.limiter,name:s.name}):void 0])}moveToWaitingChildrenArgs(e,t,r){let n=Date.now(),i=em(r.child);return["active","waiting-children",e,`${e}:dependencies`,`${e}:unsuccessful`,"stalled","events"].map(e=>this.queue.toKey(e)).concat([t,null!=i?i:"",JSON.stringify(n),e,this.queue.toKey("")])}isMaxedArgs(){let e=this.queue.keys;return[e.meta,e.active]}async isMaxed(){let e=await this.queue.client,t=this.isMaxedArgs();return!!await this.execCommand(e,"isMaxed",t)}async moveToDelayed(e,t,r,n="0",i={}){let a=await this.queue.client,s=this.moveToDelayedArgs(e,t,n,r,i),o=await this.execCommand(a,"moveToDelayed",s);if(o<0)throw this.finishedErrors({code:o,jobId:e,command:"moveToDelayed",state:"active"});if(void 0!==o)return tY(o)}async moveToWaitingChildren(e,t,r={}){let n=await this.queue.client,i=this.moveToWaitingChildrenArgs(e,t,r),a=await this.execCommand(n,"moveToWaitingChildren",i);switch(a){case 0:return!0;case 1:return!1;default:throw this.finishedErrors({code:a,jobId:e,command:"moveToWaitingChildren",state:"active"})}}getRateLimitTtlArgs(e){return[this.queue.keys.limiter,this.queue.keys.meta].concat([null!=e?e:"0"])}async getRateLimitTtl(e){let t=await this.queue.client,r=this.getRateLimitTtlArgs(e);return this.execCommand(t,"getRateLimitTtl",r)}async cleanJobsByState(e,t,r=0){let n=await this.queue.client;return this.execCommand(n,"cleanJobsInSet",[this.queue.toKey(e),this.queue.toKey("events"),this.queue.toKey("repeat"),this.queue.toKey(""),t,r,e])}getJobSchedulerArgs(e){return[this.queue.keys.repeat].concat([e])}async getJobScheduler(e){let t=await this.queue.client,r=this.getJobSchedulerArgs(e);return this.execCommand(t,"getJobScheduler",r)}async isJobScheduler(e){let t=await this.queue.client;return 1===await t.hexists(`${this.queue.keys.repeat}:${e}`,"ic")}async getJobSchedulerData(e){return(await this.queue.client).hgetall(this.queue.toKey("repeat:"+e))}async getJobSchedulersRange(e,t,r){let n=await this.queue.client,i=this.queue.keys.repeat;return r?n.zrange(i,e,t,{WITHSCORES:!0}):n.zrevrange(i,e,t,{WITHSCORES:!0})}async getJobSchedulersCount(){return(await this.queue.client).zcard(this.queue.keys.repeat)}retryJobArgs(e,t,r,n={}){return[this.queue.keys.active,this.queue.keys.wait,this.queue.keys.paused,this.queue.toKey(e),this.queue.keys.meta,this.queue.keys.events,this.queue.keys.delayed,this.queue.keys.prioritized,this.queue.keys.pc,this.queue.keys.marker,this.queue.keys.stalled].concat([this.queue.toKey(""),Date.now(),(t?"R":"L")+"PUSH",e,r,n.fieldsToUpdate?tF(en(n.fieldsToUpdate)):void 0])}async retryJob(e,t,r="0",n={}){let i=await this.queue.client,a=this.retryJobArgs(e,t,r,n),s=await this.execCommand(i,"retryJob",a);if(s<0)throw this.finishedErrors({code:s,jobId:e,command:"retryJob",state:"active"})}moveJobsToWaitArgs(e,t,r){return[this.queue.toKey(""),this.queue.keys.events,this.queue.toKey(e),this.queue.toKey("wait"),this.queue.toKey("paused"),this.queue.keys.meta,this.queue.keys.active,this.queue.keys.marker].concat([t,r,e])}async retryFinishedJobs(e="failed",t=1e3,r=new Date().getTime()){let n=await this.queue.client,i=this.moveJobsToWaitArgs(e,t,r);return this.execCommand(n,"moveJobsToWait",i)}async promoteJobs(e=1e3){let t=await this.queue.client,r=this.moveJobsToWaitArgs("delayed",e,Number.MAX_VALUE);return this.execCommand(t,"moveJobsToWait",r)}async retryFinishedJob(e,t,r={}){let n=await this.queue.client,i=[this.queue.toKey(e.id),this.queue.keys.events,this.queue.toKey(t),this.queue.keys.wait,this.queue.keys.meta,this.queue.keys.active,this.queue.keys.marker],a=[e.id,(e.opts.lifo?"R":"L")+"PUSH","failed"===t?"failedReason":"returnvalue",t,r.resetAttemptsMade?"1":"0",r.resetAttemptsStarted?"1":"0"],s=await this.execCommand(n,"reprocessJob",i.concat(a));if(1!==s)throw this.finishedErrors({code:s,jobId:e.id,command:"reprocessJob",state:t})}async getMetrics(e,t=0,r=-1){let n=await this.queue.client,i=[this.queue.toKey(`metrics:${e}`),this.queue.toKey(`metrics:${e}:data`)];return await this.execCommand(n,"getMetrics",i.concat([t,r]))}async getClientList(){let e=await this.queue.client;return e.isCluster&&"function"==typeof e.nodes?Promise.all((e.nodes()||[]).map(e=>"function"==typeof e.clientList?e.clientList():e.client("LIST"))):[await e.clientList()]}async moveToActive(e,t){let r=await this.queue.client,n=this.queue.opts,i=this.queue.keys,a=[i.wait,i.active,i.prioritized,i.events,i.stalled,i.limiter,i.delayed,i.paused,i.meta,i.pc,i.marker],s=[i[""],Date.now(),tF({token:e,lockDuration:n.lockDuration,limiter:n.limiter,name:t})];return tY(await this.execCommand(r,"moveToActive",a.concat(s)))}async promote(e){let t=await this.queue.client,r=[this.queue.keys.delayed,this.queue.keys.wait,this.queue.keys.paused,this.queue.keys.meta,this.queue.keys.prioritized,this.queue.keys.active,this.queue.keys.pc,this.queue.keys.events,this.queue.keys.marker],n=[this.queue.toKey(""),e],i=await this.execCommand(t,"promote",r.concat(n));if(i<0)throw this.finishedErrors({code:i,jobId:e,command:"promote",state:"delayed"})}moveStalledJobsToWaitArgs(){let e=this.queue.opts;return[this.queue.keys.stalled,this.queue.keys.wait,this.queue.keys.active,this.queue.keys["stalled-check"],this.queue.keys.meta,this.queue.keys.paused,this.queue.keys.marker,this.queue.keys.events,this.queue.keys.repeat].concat([e.maxStalledCount,this.queue.toKey(""),Date.now(),e.stalledInterval])}async moveStalledJobsToWait(){let e=await this.queue.client,t=this.moveStalledJobsToWaitArgs();return this.execCommand(e,"moveStalledJobsToWait",t)}async moveJobFromActiveToWait(e,t="0"){let r=await this.queue.client,n=[this.queue.keys.active,this.queue.keys.wait,this.queue.keys.stalled,this.queue.keys.paused,this.queue.keys.meta,this.queue.keys.limiter,this.queue.keys.prioritized,this.queue.keys.marker,this.queue.keys.events],i=[e,t,this.queue.toKey(e)],a=await this.execCommand(r,"moveJobFromActiveToWait",n.concat(i));if(a<0)throw this.finishedErrors({code:a,jobId:e,command:"moveJobFromActiveToWait",state:"active"});return a}async obliterate(e){let t=await this.queue.client,r=[this.queue.keys.meta,this.queue.toKey("")],n=[e.count,e.force?"force":null],i=await this.execCommand(t,"obliterate",r.concat(n));if(i<0)switch(i){case -1:throw Error("Cannot obliterate non-paused queue");case -2:throw Error("Cannot obliterate queue with active jobs")}return i}async paginate(e,t){let r=await this.queue.client,n=[e],i=t.end>=0?t.end-t.start+1:1/0,a="0",s=0,o,l,d,c=[],u=[];do{let e=[t.start+c.length,t.end,a,s,5];t.fetchJobs&&e.push(1),[a,s,o,l,d]=await this.execCommand(r,"paginate",n.concat(e)),c=c.concat(o),d&&d.length&&(u=u.concat(d.map(e=>t$(er(e)))))}while("0"!=a&&c.length<i)if(!(c.length&&Array.isArray(c[0])))return{cursor:a,items:c.map(e=>({id:e})),total:l,jobs:u};{let e=[];for(let t=0;t<c.length;t++){let[r,n]=c[t];try{e.push({id:r,v:JSON.parse(n)})}catch(t){e.push({id:r,err:t.message})}}return{cursor:a,items:e,total:l,jobs:u}}}finishedErrors({code:e,jobId:t,parentKey:r,command:n,state:i}){return tL({code:e,jobId:t,parentKey:r,command:n,state:i})}async removeOrphanedJobsBatch(e,t,r){let n=await this.queue.client,i=[this.queue.toKey(""),t.length,...t,r.length,...r,...e];return this.execCommand(n,"removeOrphanedJobs",i)}async removeOrphanedJobs(e=1e3,t=0){let r=await this.queue.client,n=this.queue.keys,i=new Set(Object.keys(n)),a=Object.keys(n).filter(e=>""!==e),s=["logs","dependencies","processed","failed","unsuccessful","lock"],o=n[""],l=o+"*",d=0,c="0";do{let[n,u]=await r.scan(c,{MATCH:l,COUNT:e});c=n;let h=new Set;for(let e of u){let t=e.slice(o.length);if(i.has(t))continue;let r=t.indexOf(":");if(-1!==r){let e=t.slice(0,r);if(i.has(e))continue}let n=-1===r?t:t.slice(0,r);if(-1!==r){let e=t.slice(r+1);if(!s.includes(e))continue}h.add(n)}if(0===h.size)continue;if(d+=await this.removeOrphanedJobsBatch([...h],a,s)||0,t>0&&d>=t)break}while("0"!==c)return d}async moveToCompleted(e,t,r,n,i){let a=Q(JSON.stringify,JSON,[t]);if(a===X)throw X.value;let s=this.moveToCompletedArgs(e,a,r,n,i);return{result:await this.moveToFinished(e.id,s),finishedOn:s[this.moveToFinishedKeys.length+1]}}async moveToFailed(e,t,r,n,i,a){let s=this.moveToFailedArgs(e,t,r,n,i,a);return{result:await this.moveToFinished(e.id,s),finishedOn:s[this.moveToFinishedKeys.length+1]}}async getJobData(e){let t=await this.queue.client,r=await t.hgetall(this.queue.toKey(e));return et(r)?void 0:t$(r)}async getDeduplicationJobId(e){return(await this.queue.client).get(`${this.queue.keys.de}:${e}`)}async getJobLogs(e,t,r,n){let i=(await this.queue.client).multi(),a=this.queue.toKey(e+":logs");n?i.lrange(a,t,r):i.lrange(a,-(r+1),-(t+1)),i.llen(a);let s=await i.exec();return n||s[0][1].reverse(),{logs:s[0][1],count:s[1][1]}}async clearLogs(e,t){let r=await this.queue.client,n=this.queue.toKey(e)+":logs";t?await r.ltrim(n,-t,-1):await r.del(n)}async getProcessedChildrenValues(e){let t=await this.queue.client;return await t.hgetall(this.queue.toKey(`${e}:processed`))}async getIgnoredChildrenFailures(e){return(await this.queue.client).hgetall(this.queue.toKey(`${e}:failed`))}async getDependencies(e,t={}){let r=(await this.queue.client).pipeline();if(t.processed||t.unprocessed||t.ignored||t.failed){let n,i,a,s,o,l,d,c,u={cursor:0,count:20},h=[];if(t.processed){h.push("processed");let n=Object.assign(Object.assign({},u),t.processed);r.hscan(this.queue.toKey(`${e}:processed`),n.cursor,{COUNT:n.count})}if(t.unprocessed){h.push("unprocessed");let n=Object.assign(Object.assign({},u),t.unprocessed);r.sscan(this.queue.toKey(`${e}:dependencies`),n.cursor,{COUNT:n.count})}if(t.ignored){h.push("ignored");let n=Object.assign(Object.assign({},u),t.ignored);r.hscan(this.queue.toKey(`${e}:failed`),n.cursor,{COUNT:n.count})}if(t.failed){h.push("failed");let i=Object.assign(Object.assign({},u),t.failed);n=i.cursor+i.count,r.zrange(this.queue.toKey(`${e}:unsuccessful`),i.cursor,i.count-1)}let p=await r.exec();return h.forEach((e,t)=>{switch(e){case"processed":{i=p[t][1][0];let e=p[t][1][1],r={};for(let t=0;t<e.length;++t)t%2&&(r[e[t-1]]=JSON.parse(e[t]));a=r;break}case"failed":l=p[t][1];break;case"ignored":{d=p[t][1][0];let e=p[t][1][1],r={};for(let t=0;t<e.length;++t)t%2&&(r[e[t-1]]=e[t]);c=r;break}case"unprocessed":s=p[t][1][0],o=p[t][1][1]}}),Object.assign(Object.assign(Object.assign(Object.assign({},i?{processed:a,nextProcessedCursor:Number(i)}:{}),d?{ignored:c,nextIgnoredCursor:Number(d)}:{}),n?{failed:l,nextFailedCursor:n}:{}),s?{unprocessed:o,nextUnprocessedCursor:Number(s)}:{})}{r.hgetall(this.queue.toKey(`${e}:processed`)),r.smembers(this.queue.toKey(`${e}:dependencies`)),r.hgetall(this.queue.toKey(`${e}:failed`)),r.zrange(this.queue.toKey(`${e}:unsuccessful`),0,-1);let[[t,n],[i,a],[s,o],[l,d]]=await r.exec();return{processed:ev(n),unprocessed:a,failed:d,ignored:o}}}async setQueueMeta(e){return(await this.queue.client).hset(this.queue.keys.meta,e)}async getQueueMetaField(e){return(await this.queue.client).hget(this.queue.keys.meta,e)}async getQueueMetaFields(e){return(await this.queue.client).hmget(this.queue.keys.meta,...e)}async getQueueMeta(){return(await this.queue.client).hgetall(this.queue.keys.meta)}async removeQueueMetaFields(e){return(await this.queue.client).hdel(this.queue.keys.meta,...e)}async hasQueueMetaField(e){let t=await this.queue.client;return 1===await t.hexists(this.queue.keys.meta,e)}async setRateLimit(e){let t=await this.queue.client;await t.set(this.queue.keys.limiter,Number.MAX_SAFE_INTEGER,{PX:e})}async removeRateLimitKey(){return(await this.queue.client).del(this.queue.keys.limiter)}async removeDeprecatedPriorityKey(){return(await this.queue.client).del(this.queue.toKey("priority"))}async deleteDeduplicationKey(e){return(await this.queue.client).del(`${this.queue.keys.de}:${e}`)}async trimEvents(e){return(await this.queue.client).xtrim(this.queue.keys.events,"MAXLEN",e,{approximate:!0})}async waitForJob(e){var t,r;let n,i=null!=(t=this.blockingConnection)?t:this.connection,a=await this.queue.blockingClient,s=i.capabilities.canDoubleTimeout?e:Math.ceil(e),o=a.bzpopmin(this.queue.keys.marker,s);o.catch(()=>null);let l=!1,d=new Promise(e=>{n=setTimeout(()=>{l=!0,e(null)},1e3*s+1e3)});try{let e=await Promise.race([o,d]);if(e){let[,t,r]=e;if(t)return{member:t,score:parseInt(r)}}return null}finally{if(clearTimeout(n),l&&!this.closing)try{await t_(null!=(r=this.blockingConnection)?r:this.connection,a,()=>this.reconnectBlocking())}catch(e){}}}async publishEvent(e,t){return(await this.queue.client).xadd(this.queue.keys.events,"*",e,{MAXLEN:t,approximate:!0})}async readEvents(e,t){let r,n=await this.queue.client,i=n.xread([{key:this.queue.keys.events,id:e}],{BLOCK:t});if(t<=0)return i;i.catch(()=>null);let a=!1,s=new Promise(e=>{r=setTimeout(()=>{a=!0,e(null)},t+1e3)});try{return await Promise.race([i,s])}finally{if(clearTimeout(r),a&&!this.closing)try{await t_(this.connection,n,()=>this.connection.reconnect())}catch(e){}}}}function tY(e){if(e){let t=[null,e[1],e[2],e[3]];return e[0]&&(t[0]=t$(er(e[0]))),t}return[]}function t$(e){return{id:e.id,name:e.name,data:e.data||"{}",opts:function(e,t=el){let r=Object.entries(JSON.parse(e||"{}")),n={};for(let e of r){let[r,i]=e;t[r]?n[t[r]]=i:"tm"===r?n.telemetry=Object.assign(Object.assign({},n.telemetry),{metadata:i}):"omc"===r?n.telemetry=Object.assign(Object.assign({},n.telemetry),{omitContext:i}):n[r]=i}return n}(e.opts),progress:JSON.parse(e.progress||"0"),delay:parseInt(e.delay),priority:parseInt(e.priority),timestamp:parseInt(e.timestamp),attemptsStarted:parseInt(e.ats||"0"),attemptsMade:parseInt(e.attemptsMade||e.atm||"0"),stalledCounter:parseInt(e.stc||"0"),finishedOn:e.finishedOn?parseInt(e.finishedOn):void 0,processedOn:e.processedOn?parseInt(e.processedOn):void 0,repeatJobKey:e.rjk,debounceId:e.deid,deduplicationId:e.deid,failedReason:e.failedReason,deferredFailure:e.defa,stacktrace:e.stacktrace,returnvalue:e.returnvalue,parentKey:e.parentKey,parent:e.parent?JSON.parse(e.parent):void 0,processedBy:e.pb}}function tW(e={},t=ed){let r=Object.entries(e),n={};for(let[e,i]of r)void 0!==i&&(e in t?n[t[e]]=i:"telemetry"===e?(void 0!==i.metadata&&(n.tm=i.metadata),void 0!==i.omitContext&&(n.omc=i.omitContext)):n[e]=i);return n}e.s(["RedisQueueBackend",0,tG,"raw2NextJobData",0,tY],19148);var tU=e.i(79430),tz=q;e.s([],61408),e.i(61408);let tH={name:"addDelayedJob",content:`--[[
  Adds a delayed job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.
    - computes timestamp.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'delayed'
      KEYS[5] 'completed'
      KEYS[6] events stream key
      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (use custom instead of one generated automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6]  parent dependencies key.
            [7]  parent? {id, queueKey}
            [8]  repeat job key
            [9] deduplication key
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options
      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local metaKey = KEYS[2]
local idKey = KEYS[3]
local delayedKey = KEYS[4]
local completedKey = KEYS[5]
local eventsKey = KEYS[6]
local jobId
local jobIdKey
local rcall = redis.call
local args = cmsgpack.unpack(ARGV[1])
local data = ARGV[2]
local parentKey = args[5]
local parent = args[7]
local repeatJobKey = args[8]
local deduplicationKey = args[9]
local parentData
-- Includes
--[[
  Adds a delayed job to the queue by doing the following:
    - Creates a new job key with the job data.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
local function addDelayedJob(jobId, delayedKey, eventsKey, timestamp,
  maxEvents, markerKey, delay)
  local score, delayedTimestamp = getDelayedScore(delayedKey, timestamp, tonumber(delay))
  rcall("ZADD", delayedKey, score, jobId)
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)
  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(markerKey, delayedKey)
end
--[[
  Function to debounce a job.
]]
-- Includes
--[[
  Function to deduplicate a job.
]]
--[[
  Function to set the deduplication key for a job.
  Uses TTL from deduplication opts if provided.
]]
local function setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
    local ttl = deduplicationOpts and deduplicationOpts['ttl']
    if ttl and ttl > 0 then
        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
    else
        rcall('SET', deduplicationKey, jobId)
    end
end
--[[
  Function to store a deduplicated next job if the existing job is active
  and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.
]]
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local function storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationOpts['keepLastIfActive'] and currentDeduplicatedJobId then
        local activeKey = prefix .. "active"
        local activeItems = rcall('LRANGE', activeKey, 0, -1)
        if checkItemInList(activeItems, currentDeduplicatedJobId) then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            local fields = {'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts),
                'jid', jobId}
            if parentKey then
                fields[#fields+1] = 'pk'
                fields[#fields+1] = parentKey
            end
            if parentData then
                fields[#fields+1] = 'pd'
                fields[#fields+1] = parentData
            end
            if parentDependenciesKey then
                fields[#fields+1] = 'pdk'
                fields[#fields+1] = parentDependenciesKey
            end
            if repeatJobKey then
                fields[#fields+1] = 'rjk'
                fields[#fields+1] = repeatJobKey
            end
            rcall('DEL', deduplicationNextKey)
            rcall('HSET', deduplicationNextKey, unpack(fields))
            -- Ensure the dedup key does not expire while the job is active,
            -- so subsequent adds always hit the dedup path and never bypass
            -- the active-check because of a TTL expiry.
            local deduplicationKey = prefix .. "de:" .. deduplicationId
            rcall('PERSIST', deduplicationKey)
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                    parentKey, parentData, parentDependenciesKey, repeatJobKey) then
                    return currentDeduplicatedJobId
                end
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, currentDeduplicatedJobId)
                else
                    setDeduplicationKey(deduplicationKey, currentDeduplicatedJobId, deduplicationOpts)
                end
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDeduplicatedJobId
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            if deduplicationOpts['keepLastIfActive'] then
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
            else
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
            end
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists then
        local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
        if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
            deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
            parentKey, parentData, parentDependenciesKey, repeatJobKey) then
            return currentDeduplicatedJobId
        end
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDeduplicatedJobId
    end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
local function removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents, currentDeduplicatedJobId,
    jobId, deduplicationId, prefix)
    if rcall("ZREM", delayedKey, currentDeduplicatedJobId) > 0 then
        removeJobKeys(prefix .. currentDeduplicatedJobId)
        rcall("XADD", eventsKey, "*", "event", "removed", "jobId", currentDeduplicatedJobId,
            "prev", "delayed")
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            jobId, "deduplicationId", deduplicationId, "deduplicatedJobId", currentDeduplicatedJobId)
        return true
    end
    return false
end
local function deduplicateJob(deduplicationOpts, jobId, delayedKey, deduplicationKey, eventsKey, maxEvents,
    prefix, jobName, jobData, fullOpts, parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local deduplicationId = deduplicationOpts and deduplicationOpts['id']
    if deduplicationId then
        if deduplicationOpts['replace'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                local isRemoved = removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents,
                    currentDeduplicatedJobId, jobId, deduplicationId, prefix)
                if isRemoved then
                    if deduplicationOpts['keepLastIfActive'] then
                        rcall('SET', deduplicationKey, jobId)
                    else
                        local ttl = deduplicationOpts['ttl']
                        if not deduplicationOpts['extend'] and ttl and ttl > 0 then
                            rcall('SET', deduplicationKey, jobId, 'KEEPTTL')
                        else
                            setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                        end
                    end
                    return
                else
                    storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                        deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                        parentKey, parentData, parentDependenciesKey, repeatJobKey)
                    return currentDeduplicatedJobId
                end
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            return deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts,
                jobId, deduplicationKey, eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
                parentKey, parentData, parentDependenciesKey, repeatJobKey)
        end
    end
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to handle the case when job is duplicated.
]]
-- Includes
--[[
    This function is used to update the parent's dependencies if the job
    is already completed and about to be ignored. The parent must get its
    dependencies updated to avoid the parent job being stuck forever in 
    the waiting-children state.
]]
-- Includes
--[[
  Validate and move or add dependencies to parent.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized)
  if no pending dependencies.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--[[
  Move parent to a wait status (wait, prioritized or delayed)
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentActiveKey = parentQueueKey .. ":active"
    local parentMetaKey = parentQueueKey .. ":meta"
    local parentMarkerKey = parentQueueKey .. ":marker"
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
        local delayedTimestamp = tonumber(timestamp) + delay
        local score = delayedTimestamp * 0x1000
        local parentDelayedKey = parentQueueKey .. ":delayed"
        rcall("ZADD", parentDelayedKey, score, parentId)
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId, "delay",
            delayedTimestamp)
        addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
    else
        if priority == 0 then
            local isParentPausedOrMaxed =
                isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobInTargetList(parentWaitKey, parentMarkerKey, "RPUSH", isParentPausedOrMaxed, parentId)
        else
            local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobWithPriority(parentMarkerKey, parentQueueKey .. ":prioritized", priority, parentId,
                parentQueueKey .. ":pc", isPausedOrMaxed)
        end
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev",
            "waiting-children")
    end
end
local function moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
      rcall("ZREM", parentWaitingChildrenKey, parentId)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
  end
end
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey,
  parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  end
end
local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
end
local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        jobIdKey, jobId, timestamp)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                     parentDependenciesKey, parent['id'],
                                     jobIdKey, returnvalue, timestamp)
        else
            if parentDependenciesKey ~= nil then
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
local function handleDuplicatedJob(jobKey, jobId, currentParentKey, currentParent,
  parentData, parentDependenciesKey, completedKey, eventsKey, maxEvents, timestamp)
  local existedParentKey = rcall("HGET", jobKey, "parentKey")
  if not existedParentKey or existedParentKey == currentParentKey then
    updateExistingJobsParent(currentParentKey, currentParent, parentData,
      parentDependenciesKey, completedKey, jobKey,
      jobId, timestamp)
  else
    if currentParentKey ~= nil and currentParentKey ~= existedParentKey
      and (rcall("EXISTS", existedParentKey) == 1) then
      return -7
    end
  end
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
    "duplicated", "jobId", jobId)
  return jobId .. "" -- convert to string
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end
    parentData = cjson.encode(parent)
end
local jobCounter = rcall("INCR", idKey)
local maxEvents = getOrSetMaxEvents(metaKey)
local opts = cmsgpack.unpack(ARGV[3])
local parentDependenciesKey = args[6]
local timestamp = args[4]
if args[2] == "" then
    jobId = jobCounter .. "" -- convert to string
    jobIdKey = args[1] .. jobId
else
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        return handleDuplicatedJob(jobIdKey, jobId, parentKey, parent,
            parentData, parentDependenciesKey, completedKey, eventsKey,
            maxEvents, timestamp)
    end
end
local deduplicationJobId = deduplicateJob(opts['de'], jobId, delayedKey, deduplicationKey,
  eventsKey, maxEvents, args[1], args[3], ARGV[2], opts,
  parentKey, parentData, parentDependenciesKey, repeatJobKey)
if deduplicationJobId then
  return deduplicationJobId
end
local delay, priority = storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2],
    opts, timestamp, parentKey, parentData, repeatJobKey)
addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, KEYS[1], delay)
-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end
return jobId
`,keys:6};e.s(["addDelayedJob",0,tH],93852),e.i(93852);let tB={name:"addJobScheduler",content:`--[[
  Adds a job scheduler, i.e. a job factory that creates jobs based on a given schedule (repeat options).
    Input:
      KEYS[1]  'repeat' key
      KEYS[2]  'delayed' key
      KEYS[3]  'wait' key
      KEYS[4]  'paused' key
      KEYS[5]  'meta' key
      KEYS[6]  'prioritized' key
      KEYS[7]  'marker' key
      KEYS[8]  'id' key
      KEYS[9]  'events' key
      KEYS[10] 'pc' priority counter
      KEYS[11] 'active' key
      ARGV[1] next milliseconds
      ARGV[2] msgpacked options
            [1]  name
            [2]  tz?
            [3]  pattern?
            [4]  endDate?
            [5]  every?
      ARGV[3] jobs scheduler id
      ARGV[4] Json stringified template data
      ARGV[5] mspacked template opts
      ARGV[6] msgpacked delayed opts
      ARGV[7] timestamp
      ARGV[8] prefix key
      ARGV[9] producer key
      Output:
        repeatableKey  - OK
]] local rcall = redis.call
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local waitKey = KEYS[3]
local pausedKey = KEYS[4]
local metaKey = KEYS[5]
local prioritizedKey = KEYS[6]
local eventsKey = KEYS[9]
local nextMillis = ARGV[1]
local jobSchedulerId = ARGV[3]
local templateOpts = cmsgpack.unpack(ARGV[5])
local now = tonumber(ARGV[7])
local prefixKey = ARGV[8]
local jobOpts = cmsgpack.unpack(ARGV[6])
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Shared helper to store a job and enqueue it into the appropriate list/set.
  Handles delayed, prioritized, and standard (LIFO/FIFO) jobs.
  Emits the appropriate event after enqueuing ("delayed" or "waiting").
  Returns delay, priority from storeJob.
]]
-- Includes
--[[
  Adds a delayed job to the queue by doing the following:
    - Creates a new job key with the job data.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
local function addDelayedJob(jobId, delayedKey, eventsKey, timestamp,
  maxEvents, markerKey, delay)
  local score, delayedTimestamp = getDelayedScore(delayedKey, timestamp, tonumber(delay))
  rcall("ZADD", delayedKey, score, jobId)
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)
  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(markerKey, delayedKey)
end
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
local function storeAndEnqueueJob(eventsKey, jobIdKey, jobId, name, data, opts,
    timestamp, parentKey, parentData, repeatJobKey, maxEvents,
    waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
    priorityCounterKey, delayedKey, markerKey)
  local delay, priority = storeJob(eventsKey, jobIdKey, jobId, name, data,
      opts, timestamp, parentKey, parentData, repeatJobKey)
  if delay ~= 0 and delayedKey then
    addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, markerKey, delay)
  else
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
    if priority > 0 then
      addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
          priorityCounterKey, isPausedOrMaxed)
    else
      local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
      addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
    end
    rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", jobId)
  end
  return delay, priority
end
local function addJobFromScheduler(jobKey, jobId, opts, waitKey, pausedKey, activeKey, metaKey, 
  prioritizedKey, priorityCounter, delayedKey, markerKey, eventsKey, name, maxEvents, timestamp,
  data, jobSchedulerId, repeatDelay)
  opts['delay'] = repeatDelay
  opts['jobId'] = jobId
  storeAndEnqueueJob(eventsKey, jobKey, jobId, name, data, opts,
      timestamp, nil, nil, jobSchedulerId, maxEvents,
      waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
      priorityCounter, delayedKey, markerKey)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check for the meta.paused attribute to decide if we are paused or not
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePaused(queueMetaKey)
  return rcall("HEXISTS", queueMetaKey, "paused") == 1
end
--[[
  Function to remove job.
]]
-- Includes
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
--[[
  Function to store a job scheduler
]]
local function storeJobScheduler(schedulerId, schedulerKey, repeatKey, nextMillis, opts,
  templateData, templateOpts)
  rcall("ZADD", repeatKey, nextMillis, schedulerId)
  local optionalValues = {}
  if opts['tz'] then
    table.insert(optionalValues, "tz")
    table.insert(optionalValues, opts['tz'])
  end
  if opts['limit'] then
    table.insert(optionalValues, "limit")
    table.insert(optionalValues, opts['limit'])
  end
  if opts['pattern'] then
    table.insert(optionalValues, "pattern")
    table.insert(optionalValues, opts['pattern'])
  end
  if opts['startDate'] then
    table.insert(optionalValues, "startDate")
    table.insert(optionalValues, opts['startDate'])
  end
  if opts['endDate'] then
    table.insert(optionalValues, "endDate")
    table.insert(optionalValues, opts['endDate'])
  end
  if opts['every'] then
    table.insert(optionalValues, "every")
    table.insert(optionalValues, opts['every'])
  end
  if opts['offset'] then
    table.insert(optionalValues, "offset")
    table.insert(optionalValues, opts['offset'])
  else
    local offset = rcall("HGET", schedulerKey, "offset")
    if offset then
      table.insert(optionalValues, "offset")
      table.insert(optionalValues, tonumber(offset))
    end
  end
  local jsonTemplateOpts = cjson.encode(templateOpts)
  if jsonTemplateOpts and jsonTemplateOpts ~= '{}' then
    table.insert(optionalValues, "opts")
    table.insert(optionalValues, jsonTemplateOpts)
  end
  if templateData and templateData ~= '{}' then
    table.insert(optionalValues, "data")
    table.insert(optionalValues, templateData)
  end
  table.insert(optionalValues, "ic")
  table.insert(optionalValues, rcall("HGET", schedulerKey, "ic") or 1)
  rcall("DEL", schedulerKey) -- remove all attributes and then re-insert new ones
  rcall("HMSET", schedulerKey, "name", opts['name'], unpack(optionalValues))
end
local function getJobSchedulerEveryNextMillis(prevMillis, every, now, offset, startDate)
    offset = tonumber(offset)
    local nextMillis
    if not prevMillis then
        if startDate then
            -- Assuming startDate is passed as milliseconds from JavaScript
            nextMillis = tonumber(startDate)
            nextMillis = nextMillis > now and nextMillis or now
        else
            if offset and offset > 0 then
                -- Align to the next slot that respects the offset
                nextMillis = math.floor(now / every) * every + offset
                if nextMillis <= now then
                    nextMillis = nextMillis + every
                end
            else
                nextMillis = now
            end
        end
    else
        nextMillis = prevMillis + every
        -- check if we may have missed some iterations
        if nextMillis < now then
            -- Use the same offset-aware alignment as the initial branch
            -- above so a non-zero offset is preserved across catch-ups
            -- instead of being flattened to (slot + every). When the
            -- aligned slot is itself still in the past, advance by one
            -- full interval; otherwise the aligned slot is the next
            -- iteration.
            local aligned = math.floor(now / every) * every + (offset or 0)
            if aligned <= now then
                nextMillis = aligned + every
            else
                nextMillis = aligned
            end
        end
    end
    if not offset or offset == 0 then
        local timeSlot = math.floor(nextMillis / every) * every;
        offset = nextMillis - timeSlot;
    end
    -- Return a tuple nextMillis, offset
    return math.floor(nextMillis), math.floor(offset)
end
-- If we are overriding a repeatable job we must delete the delayed job for
-- the next iteration.
local schedulerKey = repeatKey .. ":" .. jobSchedulerId
local maxEvents = getOrSetMaxEvents(metaKey)
local templateData = ARGV[4]
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
if prevMillis then
    prevMillis = tonumber(prevMillis)
end
local schedulerOpts = cmsgpack.unpack(ARGV[2])
local every = schedulerOpts['every']
-- For backwards compatibility we also check the offset from the job itself.
-- could be removed in future major versions.
local jobOffset = jobOpts['repeat'] and jobOpts['repeat']['offset'] or 0
local offset = schedulerOpts['offset'] or jobOffset or 0
local newOffset = offset
local updatedEvery = false
if every then
    -- if we changed the 'every' value we need to reset millis to nil
    local millis = prevMillis
    if prevMillis then
        local prevEvery = tonumber(rcall("HGET", schedulerKey, "every"))
        if prevEvery ~= every then
            millis = nil
            updatedEvery = true
        end
    end
    local startDate = schedulerOpts['startDate']
    nextMillis, newOffset = getJobSchedulerEveryNextMillis(millis, every, now, offset, startDate)
end
local function removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, waitKey, pausedKey, jobId, metaKey,
    eventsKey)
    if rcall("ZSCORE", delayedKey, jobId) then
        removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
        rcall("ZREM", delayedKey, jobId)
        return true
    elseif rcall("ZSCORE", prioritizedKey, jobId) then
        removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
        rcall("ZREM", prioritizedKey, jobId)
        return true
    else
        local pausedOrWaitKey = waitKey
        if isQueuePaused(metaKey) then
            pausedOrWaitKey = pausedKey
        end
        if rcall("LREM", pausedOrWaitKey, 1, jobId) > 0 then
            removeJob(jobId, true, prefixKey, true --[[remove debounce key]] )
            return true
        end
    end
    return false
end
local removedPrevJob = false
if prevMillis then
    local currentJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis
    local currentJobKey = schedulerKey .. ":" .. prevMillis
    -- In theory it should always exist the currentJobKey if there is a prevMillis unless something has
    -- gone really wrong.
    if rcall("EXISTS", currentJobKey) == 1 then
        removedPrevJob = removeJobFromScheduler(prefixKey, delayedKey, prioritizedKey, waitKey, pausedKey, currentJobId,
            metaKey, eventsKey)
    end
end
if removedPrevJob then
    -- The jobs has been removed and we want to replace it, so lets use the same millis.
    if every and not updatedEvery then
        nextMillis = prevMillis
    end
else
    -- Special case where no job was removed, and we need to add the next iteration.
    schedulerOpts['offset'] = newOffset
end
-- Check for job ID collision with existing jobs (in any state)
local jobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
local jobKey = prefixKey .. jobId
-- If there's already a job with this ID, in a state
-- that is not updatable (active, completed, failed) we must
-- handle the collision
local hasCollision = false
if rcall("EXISTS", jobKey) == 1 then
    if every then
        -- For 'every' case: walk forward through subsequent slots
        -- until we find a free one. Stale completed/failed jobs from
        -- a previous scheduler under the same id can occupy several
        -- consecutive slots (issue #3063), so a single retry is not
        -- enough. The scan is bounded so we don't spin if the
        -- scheduler is genuinely contested.
        local maxSlotScans = 32
        local slotsScanned = 0
        local jobExists
        repeat
            nextMillis = nextMillis + every
            jobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
            jobKey = prefixKey .. jobId
            slotsScanned = slotsScanned + 1
            jobExists = rcall("EXISTS", jobKey)
        until jobExists == 0 or slotsScanned >= maxSlotScans
        if jobExists == 1 then
            -- Every scanned slot still has a job, return error code
            return -11 -- SchedulerJobSlotsBusy
        end
    else
        hasCollision = true
    end
end
local delay = nextMillis - now
-- Fast Clamp delay to minimum of 0
if delay < 0 then
    delay = 0
end
local nextJobKey = schedulerKey .. ":" .. nextMillis
if not hasCollision or removedPrevJob then
    -- jobId already calculated above during collision check
    storeJobScheduler(jobSchedulerId, schedulerKey, repeatKey, nextMillis, schedulerOpts, templateData, templateOpts)
    rcall("INCR", KEYS[8])
    addJobFromScheduler(nextJobKey, jobId, jobOpts, waitKey, pausedKey, KEYS[11], metaKey, prioritizedKey, KEYS[10],
        delayedKey, KEYS[7], eventsKey, schedulerOpts['name'], maxEvents, now, templateData, jobSchedulerId, delay)
elseif hasCollision then
    -- For 'pattern' case: return error code
    return -10 -- SchedulerJobIdCollision
end
return {jobId .. "", delay}
`,keys:11};e.s(["addJobScheduler",0,tB],27599),e.i(27599);let tZ={name:"addLog",content:`--[[
  Add job log
  Input:
    KEYS[1] job id key
    KEYS[2] job logs key
    ARGV[1] id
    ARGV[2] log
    ARGV[3] keepLogs
  Output:
    -1 - Missing job.
]]
local rcall = redis.call
if rcall("EXISTS", KEYS[1]) == 1 then -- // Make sure job exists
  local logCount = rcall("RPUSH", KEYS[2], ARGV[2])
  if ARGV[3] ~= '' then
    local keepLogs = tonumber(ARGV[3])
    rcall("LTRIM", KEYS[2], -keepLogs, -1)
    return math.min(keepLogs, logCount)
  end
  return logCount
else
  return -1
end
`,keys:2};e.s(["addLog",0,tZ],92879),e.i(92879);let tX={name:"addParentJob",content:`--[[
  Adds a parent job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.
    - adds the job to the waiting-children zset
    Input:
      KEYS[1] 'meta'
      KEYS[2] 'id'
      KEYS[3] 'delayed'
      KEYS[4] 'waiting-children'
      KEYS[5] 'completed'
      KEYS[6] events stream key
      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (will not generate one automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6]  parent dependencies key.
            [7]  parent? {id, queueKey}
            [8]  repeat job key
            [9] deduplication key
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options
      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local metaKey = KEYS[1]
local idKey = KEYS[2]
local delayedKey = KEYS[3]
local completedKey = KEYS[5]
local eventsKey = KEYS[6]
local jobId
local jobIdKey
local rcall = redis.call
local args = cmsgpack.unpack(ARGV[1])
local data = ARGV[2]
local opts = cmsgpack.unpack(ARGV[3])
local parentKey = args[5]
local parent = args[7]
local repeatJobKey = args[8]
local deduplicationKey = args[9]
local parentData
-- Includes
--[[
  Function to deduplicate a job.
]]
--[[
  Function to set the deduplication key for a job.
  Uses TTL from deduplication opts if provided.
]]
local function setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
    local ttl = deduplicationOpts and deduplicationOpts['ttl']
    if ttl and ttl > 0 then
        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
    else
        rcall('SET', deduplicationKey, jobId)
    end
end
--[[
  Function to store a deduplicated next job if the existing job is active
  and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.
]]
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local function storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationOpts['keepLastIfActive'] and currentDeduplicatedJobId then
        local activeKey = prefix .. "active"
        local activeItems = rcall('LRANGE', activeKey, 0, -1)
        if checkItemInList(activeItems, currentDeduplicatedJobId) then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            local fields = {'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts),
                'jid', jobId}
            if parentKey then
                fields[#fields+1] = 'pk'
                fields[#fields+1] = parentKey
            end
            if parentData then
                fields[#fields+1] = 'pd'
                fields[#fields+1] = parentData
            end
            if parentDependenciesKey then
                fields[#fields+1] = 'pdk'
                fields[#fields+1] = parentDependenciesKey
            end
            if repeatJobKey then
                fields[#fields+1] = 'rjk'
                fields[#fields+1] = repeatJobKey
            end
            rcall('DEL', deduplicationNextKey)
            rcall('HSET', deduplicationNextKey, unpack(fields))
            -- Ensure the dedup key does not expire while the job is active,
            -- so subsequent adds always hit the dedup path and never bypass
            -- the active-check because of a TTL expiry.
            local deduplicationKey = prefix .. "de:" .. deduplicationId
            rcall('PERSIST', deduplicationKey)
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                    parentKey, parentData, parentDependenciesKey, repeatJobKey) then
                    return currentDeduplicatedJobId
                end
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, currentDeduplicatedJobId)
                else
                    setDeduplicationKey(deduplicationKey, currentDeduplicatedJobId, deduplicationOpts)
                end
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDeduplicatedJobId
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            if deduplicationOpts['keepLastIfActive'] then
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
            else
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
            end
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists then
        local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
        if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
            deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
            parentKey, parentData, parentDependenciesKey, repeatJobKey) then
            return currentDeduplicatedJobId
        end
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDeduplicatedJobId
    end
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to handle the case when job is duplicated.
]]
-- Includes
--[[
    This function is used to update the parent's dependencies if the job
    is already completed and about to be ignored. The parent must get its
    dependencies updated to avoid the parent job being stuck forever in 
    the waiting-children state.
]]
-- Includes
--[[
  Validate and move or add dependencies to parent.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized)
  if no pending dependencies.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--[[
  Move parent to a wait status (wait, prioritized or delayed)
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentActiveKey = parentQueueKey .. ":active"
    local parentMetaKey = parentQueueKey .. ":meta"
    local parentMarkerKey = parentQueueKey .. ":marker"
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
        local delayedTimestamp = tonumber(timestamp) + delay
        local score = delayedTimestamp * 0x1000
        local parentDelayedKey = parentQueueKey .. ":delayed"
        rcall("ZADD", parentDelayedKey, score, parentId)
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId, "delay",
            delayedTimestamp)
        addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
    else
        if priority == 0 then
            local isParentPausedOrMaxed =
                isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobInTargetList(parentWaitKey, parentMarkerKey, "RPUSH", isParentPausedOrMaxed, parentId)
        else
            local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobWithPriority(parentMarkerKey, parentQueueKey .. ":prioritized", priority, parentId,
                parentQueueKey .. ":pc", isPausedOrMaxed)
        end
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev",
            "waiting-children")
    end
end
local function moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
      rcall("ZREM", parentWaitingChildrenKey, parentId)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
  end
end
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey,
  parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  end
end
local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
end
local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        jobIdKey, jobId, timestamp)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                     parentDependenciesKey, parent['id'],
                                     jobIdKey, returnvalue, timestamp)
        else
            if parentDependenciesKey ~= nil then
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
local function handleDuplicatedJob(jobKey, jobId, currentParentKey, currentParent,
  parentData, parentDependenciesKey, completedKey, eventsKey, maxEvents, timestamp)
  local existedParentKey = rcall("HGET", jobKey, "parentKey")
  if not existedParentKey or existedParentKey == currentParentKey then
    updateExistingJobsParent(currentParentKey, currentParent, parentData,
      parentDependenciesKey, completedKey, jobKey,
      jobId, timestamp)
  else
    if currentParentKey ~= nil and currentParentKey ~= existedParentKey
      and (rcall("EXISTS", existedParentKey) == 1) then
      return -7
    end
  end
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
    "duplicated", "jobId", jobId)
  return jobId .. "" -- convert to string
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end
    parentData = cjson.encode(parent)
end
local jobCounter = rcall("INCR", idKey)
local maxEvents = getOrSetMaxEvents(metaKey)
local parentDependenciesKey = args[6]
local timestamp = args[4]
if args[2] == "" then
    jobId = jobCounter .. "" -- convert to string
    jobIdKey = args[1] .. jobId
else
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        return handleDuplicatedJob(jobIdKey, jobId, parentKey, parent,
            parentData, parentDependenciesKey, completedKey, eventsKey,
            maxEvents, timestamp)
    end
end
local deduplicationId = opts['de'] and opts['de']['id']
if deduplicationId then
    local deduplicationJobId = deduplicateJobWithoutReplace(deduplicationId, opts['de'],
        jobId, deduplicationKey, eventsKey, maxEvents, args[1], args[3], ARGV[2], opts,
        parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationJobId then
        return deduplicationJobId
    end
end
-- Store the job.
storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2], opts, timestamp,
         parentKey, parentData, repeatJobKey)
local waitChildrenKey = KEYS[4]
rcall("ZADD", waitChildrenKey, timestamp, jobId)
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
      "waiting-children", "jobId", jobId)
-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end
return jobId
`,keys:6};e.s(["addParentJob",0,tX],19348),e.i(19348);let tQ={name:"addPrioritizedJob",content:`--[[
  Adds a prioritized job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.
    - Adds the job to the "added" list so that workers gets notified.
    Input:
      KEYS[1] 'marker',
      KEYS[2] 'meta'
      KEYS[3] 'id'
      KEYS[4] 'prioritized'
      KEYS[5] 'delayed'
      KEYS[6] 'completed'
      KEYS[7] 'active'
      KEYS[8] events stream key
      KEYS[9] 'pc' priority counter
      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (will not generate one automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6]  parent dependencies key.
            [7]  parent? {id, queueKey}
            [8]  repeat job key
            [9] deduplication key
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options
      Output:
        jobId  - OK
        -5     - Missing parent key
]] 
local metaKey = KEYS[2]
local idKey = KEYS[3]
local priorityKey = KEYS[4]
local completedKey = KEYS[6]
local activeKey = KEYS[7]
local eventsKey = KEYS[8]
local priorityCounterKey = KEYS[9]
local jobId
local jobIdKey
local rcall = redis.call
local args = cmsgpack.unpack(ARGV[1])
local data = ARGV[2]
local opts = cmsgpack.unpack(ARGV[3])
local parentKey = args[5]
local parent = args[7]
local repeatJobKey = args[8]
local deduplicationKey = args[9]
local parentData
-- Includes
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to debounce a job.
]]
-- Includes
--[[
  Function to deduplicate a job.
]]
--[[
  Function to set the deduplication key for a job.
  Uses TTL from deduplication opts if provided.
]]
local function setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
    local ttl = deduplicationOpts and deduplicationOpts['ttl']
    if ttl and ttl > 0 then
        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
    else
        rcall('SET', deduplicationKey, jobId)
    end
end
--[[
  Function to store a deduplicated next job if the existing job is active
  and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.
]]
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local function storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationOpts['keepLastIfActive'] and currentDeduplicatedJobId then
        local activeKey = prefix .. "active"
        local activeItems = rcall('LRANGE', activeKey, 0, -1)
        if checkItemInList(activeItems, currentDeduplicatedJobId) then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            local fields = {'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts),
                'jid', jobId}
            if parentKey then
                fields[#fields+1] = 'pk'
                fields[#fields+1] = parentKey
            end
            if parentData then
                fields[#fields+1] = 'pd'
                fields[#fields+1] = parentData
            end
            if parentDependenciesKey then
                fields[#fields+1] = 'pdk'
                fields[#fields+1] = parentDependenciesKey
            end
            if repeatJobKey then
                fields[#fields+1] = 'rjk'
                fields[#fields+1] = repeatJobKey
            end
            rcall('DEL', deduplicationNextKey)
            rcall('HSET', deduplicationNextKey, unpack(fields))
            -- Ensure the dedup key does not expire while the job is active,
            -- so subsequent adds always hit the dedup path and never bypass
            -- the active-check because of a TTL expiry.
            local deduplicationKey = prefix .. "de:" .. deduplicationId
            rcall('PERSIST', deduplicationKey)
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                    parentKey, parentData, parentDependenciesKey, repeatJobKey) then
                    return currentDeduplicatedJobId
                end
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, currentDeduplicatedJobId)
                else
                    setDeduplicationKey(deduplicationKey, currentDeduplicatedJobId, deduplicationOpts)
                end
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDeduplicatedJobId
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            if deduplicationOpts['keepLastIfActive'] then
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
            else
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
            end
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists then
        local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
        if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
            deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
            parentKey, parentData, parentDependenciesKey, repeatJobKey) then
            return currentDeduplicatedJobId
        end
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDeduplicatedJobId
    end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
local function removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents, currentDeduplicatedJobId,
    jobId, deduplicationId, prefix)
    if rcall("ZREM", delayedKey, currentDeduplicatedJobId) > 0 then
        removeJobKeys(prefix .. currentDeduplicatedJobId)
        rcall("XADD", eventsKey, "*", "event", "removed", "jobId", currentDeduplicatedJobId,
            "prev", "delayed")
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            jobId, "deduplicationId", deduplicationId, "deduplicatedJobId", currentDeduplicatedJobId)
        return true
    end
    return false
end
local function deduplicateJob(deduplicationOpts, jobId, delayedKey, deduplicationKey, eventsKey, maxEvents,
    prefix, jobName, jobData, fullOpts, parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local deduplicationId = deduplicationOpts and deduplicationOpts['id']
    if deduplicationId then
        if deduplicationOpts['replace'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                local isRemoved = removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents,
                    currentDeduplicatedJobId, jobId, deduplicationId, prefix)
                if isRemoved then
                    if deduplicationOpts['keepLastIfActive'] then
                        rcall('SET', deduplicationKey, jobId)
                    else
                        local ttl = deduplicationOpts['ttl']
                        if not deduplicationOpts['extend'] and ttl and ttl > 0 then
                            rcall('SET', deduplicationKey, jobId, 'KEEPTTL')
                        else
                            setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                        end
                    end
                    return
                else
                    storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                        deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                        parentKey, parentData, parentDependenciesKey, repeatJobKey)
                    return currentDeduplicatedJobId
                end
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            return deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts,
                jobId, deduplicationKey, eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
                parentKey, parentData, parentDependenciesKey, repeatJobKey)
        end
    end
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to handle the case when job is duplicated.
]]
-- Includes
--[[
    This function is used to update the parent's dependencies if the job
    is already completed and about to be ignored. The parent must get its
    dependencies updated to avoid the parent job being stuck forever in 
    the waiting-children state.
]]
-- Includes
--[[
  Validate and move or add dependencies to parent.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized)
  if no pending dependencies.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--[[
  Move parent to a wait status (wait, prioritized or delayed)
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentActiveKey = parentQueueKey .. ":active"
    local parentMetaKey = parentQueueKey .. ":meta"
    local parentMarkerKey = parentQueueKey .. ":marker"
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
        local delayedTimestamp = tonumber(timestamp) + delay
        local score = delayedTimestamp * 0x1000
        local parentDelayedKey = parentQueueKey .. ":delayed"
        rcall("ZADD", parentDelayedKey, score, parentId)
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId, "delay",
            delayedTimestamp)
        addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
    else
        if priority == 0 then
            local isParentPausedOrMaxed =
                isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobInTargetList(parentWaitKey, parentMarkerKey, "RPUSH", isParentPausedOrMaxed, parentId)
        else
            local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobWithPriority(parentMarkerKey, parentQueueKey .. ":prioritized", priority, parentId,
                parentQueueKey .. ":pc", isPausedOrMaxed)
        end
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev",
            "waiting-children")
    end
end
local function moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
      rcall("ZREM", parentWaitingChildrenKey, parentId)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
  end
end
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey,
  parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  end
end
local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
end
local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        jobIdKey, jobId, timestamp)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                     parentDependenciesKey, parent['id'],
                                     jobIdKey, returnvalue, timestamp)
        else
            if parentDependenciesKey ~= nil then
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
local function handleDuplicatedJob(jobKey, jobId, currentParentKey, currentParent,
  parentData, parentDependenciesKey, completedKey, eventsKey, maxEvents, timestamp)
  local existedParentKey = rcall("HGET", jobKey, "parentKey")
  if not existedParentKey or existedParentKey == currentParentKey then
    updateExistingJobsParent(currentParentKey, currentParent, parentData,
      parentDependenciesKey, completedKey, jobKey,
      jobId, timestamp)
  else
    if currentParentKey ~= nil and currentParentKey ~= existedParentKey
      and (rcall("EXISTS", existedParentKey) == 1) then
      return -7
    end
  end
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
    "duplicated", "jobId", jobId)
  return jobId .. "" -- convert to string
end
if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end
    parentData = cjson.encode(parent)
end
local jobCounter = rcall("INCR", idKey)
local maxEvents = getOrSetMaxEvents(metaKey)
local parentDependenciesKey = args[6]
local timestamp = args[4]
if args[2] == "" then
    jobId = jobCounter .. "" -- convert to string
    jobIdKey = args[1] .. jobId
else
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        return handleDuplicatedJob(jobIdKey, jobId, parentKey, parent,
            parentData, parentDependenciesKey, completedKey, eventsKey,
            maxEvents, timestamp)
    end
end
local deduplicationJobId = deduplicateJob(opts['de'], jobId, KEYS[5],
  deduplicationKey, eventsKey, maxEvents, args[1], args[3], ARGV[2], opts,
  parentKey, parentData, parentDependenciesKey, repeatJobKey)
if deduplicationJobId then
  return deduplicationJobId
end
-- Store the job.
local delay, priority = storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2],
                                 opts, timestamp, parentKey, parentData,
                                 repeatJobKey)
-- Add the job to the prioritized set
local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
addJobWithPriority( KEYS[1], priorityKey, priority, jobId, priorityCounterKey, isPausedOrMaxed)
-- Emit waiting event
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId)
-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end
return jobId
`,keys:9};e.s(["addPrioritizedJob",0,tQ],55494),e.i(55494);let t0={name:"addStandardJob",content:`--[[
  Adds a job to the queue by doing the following:
    - Increases the job counter if needed.
    - Creates a new job key with the job data.
    - if delayed:
      - computes timestamp.
      - adds to delayed zset.
      - Emits a global event 'delayed' if the job is delayed.
    - if not delayed
      - Adds the jobId to the wait/paused list in one of three ways:
         - LIFO
         - FIFO
         - prioritized.
      - Adds the job to the "added" list so that workers gets notified.
    Input:
      KEYS[1] 'wait',
      KEYS[2] 'paused'
      KEYS[3] 'meta'
      KEYS[4] 'id'
      KEYS[5] 'completed'
      KEYS[6] 'delayed'
      KEYS[7] 'active'
      KEYS[8] events stream key
      KEYS[9] marker key
      ARGV[1] msgpacked arguments array
            [1]  key prefix,
            [2]  custom id (will not generate one automatically)
            [3]  name
            [4]  timestamp
            [5]  parentKey?
            [6]  parent dependencies key.
            [7]  parent? {id, queueKey}
            [8]  repeat job key
            [9] deduplication key
      ARGV[2] Json stringified job data
      ARGV[3] msgpacked options
      Output:
        jobId  - OK
        -5     - Missing parent key
]]
local waitKey = KEYS[1]
local metaKey = KEYS[3]
local activeKey = KEYS[7]
local eventsKey = KEYS[8]
local jobId
local jobIdKey
local rcall = redis.call
local args = cmsgpack.unpack(ARGV[1])
local data = ARGV[2]
local opts = cmsgpack.unpack(ARGV[3])
local parentKey = args[5]
local parent = args[7]
local repeatJobKey = args[8]
local deduplicationKey = args[9]
local parentData
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to debounce a job.
]]
-- Includes
--[[
  Function to deduplicate a job.
]]
--[[
  Function to set the deduplication key for a job.
  Uses TTL from deduplication opts if provided.
]]
local function setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
    local ttl = deduplicationOpts and deduplicationOpts['ttl']
    if ttl and ttl > 0 then
        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
    else
        rcall('SET', deduplicationKey, jobId)
    end
end
--[[
  Function to store a deduplicated next job if the existing job is active
  and keepLastIfActive is set. When the active job finishes, the stored
  proto-job is used to create a real job in the queue.
  Returns true if the proto-job was stored, false otherwise.
]]
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local function storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    if deduplicationOpts['keepLastIfActive'] and currentDeduplicatedJobId then
        local activeKey = prefix .. "active"
        local activeItems = rcall('LRANGE', activeKey, 0, -1)
        if checkItemInList(activeItems, currentDeduplicatedJobId) then
            local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
            local fields = {'name', jobName, 'data', jobData, 'opts', cjson.encode(fullOpts),
                'jid', jobId}
            if parentKey then
                fields[#fields+1] = 'pk'
                fields[#fields+1] = parentKey
            end
            if parentData then
                fields[#fields+1] = 'pd'
                fields[#fields+1] = parentData
            end
            if parentDependenciesKey then
                fields[#fields+1] = 'pdk'
                fields[#fields+1] = parentDependenciesKey
            end
            if repeatJobKey then
                fields[#fields+1] = 'rjk'
                fields[#fields+1] = repeatJobKey
            end
            rcall('DEL', deduplicationNextKey)
            rcall('HSET', deduplicationNextKey, unpack(fields))
            -- Ensure the dedup key does not expire while the job is active,
            -- so subsequent adds always hit the dedup path and never bypass
            -- the active-check because of a TTL expiry.
            local deduplicationKey = prefix .. "de:" .. deduplicationId
            rcall('PERSIST', deduplicationKey)
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
            return true
        end
    end
    return false
end
local function deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts, jobId, deduplicationKey,
    eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
    parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local ttl = deduplicationOpts['ttl']
    local deduplicationKeyExists
    if ttl and ttl > 0 then
        if deduplicationOpts['extend'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                    deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                    parentKey, parentData, parentDependenciesKey, repeatJobKey) then
                    return currentDeduplicatedJobId
                end
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, currentDeduplicatedJobId)
                else
                    setDeduplicationKey(deduplicationKey, currentDeduplicatedJobId, deduplicationOpts)
                end
                rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
                    currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
                return currentDeduplicatedJobId
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            if deduplicationOpts['keepLastIfActive'] then
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
            else
                deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'PX', ttl, 'NX')
            end
        end
    else
        deduplicationKeyExists = not rcall('SET', deduplicationKey, jobId, 'NX')
    end
    if deduplicationKeyExists then
        local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
        if storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
            deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
            parentKey, parentData, parentDependenciesKey, repeatJobKey) then
            return currentDeduplicatedJobId
        end
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            currentDeduplicatedJobId, "deduplicationId", deduplicationId, "deduplicatedJobId", jobId)
        return currentDeduplicatedJobId
    end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
local function removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents, currentDeduplicatedJobId,
    jobId, deduplicationId, prefix)
    if rcall("ZREM", delayedKey, currentDeduplicatedJobId) > 0 then
        removeJobKeys(prefix .. currentDeduplicatedJobId)
        rcall("XADD", eventsKey, "*", "event", "removed", "jobId", currentDeduplicatedJobId,
            "prev", "delayed")
        rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "deduplicated", "jobId",
            jobId, "deduplicationId", deduplicationId, "deduplicatedJobId", currentDeduplicatedJobId)
        return true
    end
    return false
end
local function deduplicateJob(deduplicationOpts, jobId, delayedKey, deduplicationKey, eventsKey, maxEvents,
    prefix, jobName, jobData, fullOpts, parentKey, parentData, parentDependenciesKey, repeatJobKey)
    local deduplicationId = deduplicationOpts and deduplicationOpts['id']
    if deduplicationId then
        if deduplicationOpts['replace'] then
            local currentDeduplicatedJobId = rcall('GET', deduplicationKey)
            if currentDeduplicatedJobId then
                local isRemoved = removeDelayedJob(delayedKey, deduplicationKey, eventsKey, maxEvents,
                    currentDeduplicatedJobId, jobId, deduplicationId, prefix)
                if isRemoved then
                    if deduplicationOpts['keepLastIfActive'] then
                        rcall('SET', deduplicationKey, jobId)
                    else
                        local ttl = deduplicationOpts['ttl']
                        if not deduplicationOpts['extend'] and ttl and ttl > 0 then
                            rcall('SET', deduplicationKey, jobId, 'KEEPTTL')
                        else
                            setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                        end
                    end
                    return
                else
                    storeDeduplicatedNextJob(deduplicationOpts, currentDeduplicatedJobId, prefix,
                        deduplicationId, jobName, jobData, fullOpts, eventsKey, maxEvents, jobId,
                        parentKey, parentData, parentDependenciesKey, repeatJobKey)
                    return currentDeduplicatedJobId
                end
            else
                if deduplicationOpts['keepLastIfActive'] then
                    rcall('SET', deduplicationKey, jobId)
                else
                    setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
                end
                return
            end
        else
            return deduplicateJobWithoutReplace(deduplicationId, deduplicationOpts,
                jobId, deduplicationKey, eventsKey, maxEvents, prefix, jobName, jobData, fullOpts,
                parentKey, parentData, parentDependenciesKey, repeatJobKey)
        end
    end
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to handle the case when job is duplicated.
]]
-- Includes
--[[
    This function is used to update the parent's dependencies if the job
    is already completed and about to be ignored. The parent must get its
    dependencies updated to avoid the parent job being stuck forever in 
    the waiting-children state.
]]
-- Includes
--[[
  Validate and move or add dependencies to parent.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized)
  if no pending dependencies.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--[[
  Move parent to a wait status (wait, prioritized or delayed)
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentActiveKey = parentQueueKey .. ":active"
    local parentMetaKey = parentQueueKey .. ":meta"
    local parentMarkerKey = parentQueueKey .. ":marker"
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
        local delayedTimestamp = tonumber(timestamp) + delay
        local score = delayedTimestamp * 0x1000
        local parentDelayedKey = parentQueueKey .. ":delayed"
        rcall("ZADD", parentDelayedKey, score, parentId)
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId, "delay",
            delayedTimestamp)
        addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
    else
        if priority == 0 then
            local isParentPausedOrMaxed =
                isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobInTargetList(parentWaitKey, parentMarkerKey, "RPUSH", isParentPausedOrMaxed, parentId)
        else
            local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobWithPriority(parentMarkerKey, parentQueueKey .. ":prioritized", priority, parentId,
                parentQueueKey .. ":pc", isPausedOrMaxed)
        end
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev",
            "waiting-children")
    end
end
local function moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
      rcall("ZREM", parentWaitingChildrenKey, parentId)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
  end
end
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey,
  parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  end
end
local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
end
local function updateExistingJobsParent(parentKey, parent, parentData,
                                        parentDependenciesKey, completedKey,
                                        jobIdKey, jobId, timestamp)
    if parentKey ~= nil then
        if rcall("ZSCORE", completedKey, jobId) then
            local returnvalue = rcall("HGET", jobIdKey, "returnvalue")
            updateParentDepsIfNeeded(parentKey, parent['queueKey'],
                                     parentDependenciesKey, parent['id'],
                                     jobIdKey, returnvalue, timestamp)
        else
            if parentDependenciesKey ~= nil then
                rcall("SADD", parentDependenciesKey, jobIdKey)
            end
        end
        rcall("HMSET", jobIdKey, "parentKey", parentKey, "parent", parentData)
    end
end
local function handleDuplicatedJob(jobKey, jobId, currentParentKey, currentParent,
  parentData, parentDependenciesKey, completedKey, eventsKey, maxEvents, timestamp)
  local existedParentKey = rcall("HGET", jobKey, "parentKey")
  if not existedParentKey or existedParentKey == currentParentKey then
    updateExistingJobsParent(currentParentKey, currentParent, parentData,
      parentDependenciesKey, completedKey, jobKey,
      jobId, timestamp)
  else
    if currentParentKey ~= nil and currentParentKey ~= existedParentKey
      and (rcall("EXISTS", existedParentKey) == 1) then
      return -7
    end
  end
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event",
    "duplicated", "jobId", jobId)
  return jobId .. "" -- convert to string
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
if parentKey ~= nil then
    if rcall("EXISTS", parentKey) ~= 1 then return -5 end
    parentData = cjson.encode(parent)
end
local jobCounter = rcall("INCR", KEYS[4])
local maxEvents = getOrSetMaxEvents(metaKey)
local parentDependenciesKey = args[6]
local timestamp = args[4]
if args[2] == "" then
    jobId = jobCounter .. "" -- convert to string
    jobIdKey = args[1] .. jobId
else
    jobId = args[2]
    jobIdKey = args[1] .. jobId
    if rcall("EXISTS", jobIdKey) == 1 then
        return handleDuplicatedJob(jobIdKey, jobId, parentKey, parent,
            parentData, parentDependenciesKey, KEYS[5], eventsKey,
            maxEvents, timestamp)
    end
end
local deduplicationJobId = deduplicateJob(opts['de'], jobId, KEYS[6],
  deduplicationKey, eventsKey, maxEvents, args[1], args[3], ARGV[2], opts,
  parentKey, parentData, parentDependenciesKey, repeatJobKey)
if deduplicationJobId then
  return deduplicationJobId
end
-- Store the job.
storeJob(eventsKey, jobIdKey, jobId, args[3], ARGV[2], opts, timestamp,
        parentKey, parentData, repeatJobKey)
local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
-- LIFO or FIFO
local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
addJobInTargetList(waitKey, KEYS[9], pushCmd, isPausedOrMaxed, jobId)
-- Emit waiting event
rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId)
-- Check if this job is a child of another job, if so add it to the parents dependencies
if parentDependenciesKey ~= nil then
    rcall("SADD", parentDependenciesKey, jobIdKey)
end
return jobId
`,keys:9};e.s(["addStandardJob",0,t0],1939),e.i(1939);let t1={name:"changeDelay",content:`--[[
  Change job delay when it is in delayed set.
  Input:
    KEYS[1] delayed key
    KEYS[2] meta key
    KEYS[3] marker key
    KEYS[4] events stream
    ARGV[1] delay
    ARGV[2] timestamp
    ARGV[3] the id of the job
    ARGV[4] job key
  Output:
    0 - OK
   -1 - Missing job.
   -3 - Job not in delayed set.
  Events:
    - delayed key.
]]
local rcall = redis.call
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
if rcall("EXISTS", ARGV[4]) == 1 then
  local jobId = ARGV[3]
  local delay = tonumber(ARGV[1])
  local score, delayedTimestamp = getDelayedScore(KEYS[1], ARGV[2], delay)
  local numRemovedElements = rcall("ZREM", KEYS[1], jobId)
  if numRemovedElements < 1 then
    return -3
  end
  rcall("HSET", ARGV[4], "delay", delay)
  rcall("ZADD", KEYS[1], score, jobId)
  local maxEvents = getOrSetMaxEvents(KEYS[2])
  rcall("XADD", KEYS[4], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)
  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(KEYS[3], KEYS[1])
  return 0
else
  return -1
end`,keys:4};e.s(["changeDelay",0,t1],24195),e.i(24195);let t2={name:"changePriority",content:`--[[
  Change job priority
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] 'active'
    KEYS[6] 'pc' priority counter
    KEYS[7] 'marker'
    ARGV[1] priority value
    ARGV[2] prefix key
    ARGV[3] job id
    ARGV[4] lifo
    Output:
       0  - OK
      -1  - Missing job
]]
local jobId = ARGV[3]
local jobKey = ARGV[2] .. jobId
local priority = tonumber(ARGV[1])
local rcall = redis.call
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
--[[
  Function to push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(prioritizedKey, priority, jobId)
  -- in order to put it at front of same prioritized jobs
  -- we consider prioritized counter as 0
  local score = priority * 0x100000000
  rcall("ZADD", prioritizedKey, score, jobId)
end
local function reAddJobWithNewPriority( prioritizedKey, markerKey, waitKey,
    priorityCounter, lifo, priority, jobId, isPausedOrMaxed)
    if priority == 0 then
        local pushCmd = lifo and 'RPUSH' or 'LPUSH'
        addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
    else
        if lifo then
            pushBackJobWithPriority(prioritizedKey, priority, jobId)
        else
            addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
                priorityCounter, isPausedOrMaxed)
        end
    end
end
if rcall("EXISTS", jobKey) == 1 then
    local metaKey = KEYS[3]
    local activeKey = KEYS[5]
    local waitKey = KEYS[1]
    local pausedKey = KEYS[2]
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
    local prioritizedKey = KEYS[4]
    local priorityCounterKey = KEYS[6]
    local markerKey = KEYS[7]
    -- Re-add with the new priority
    if rcall("ZREM", prioritizedKey, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, waitKey,
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    elseif rcall("LREM", waitKey, -1, jobId) > 0 then
        reAddJobWithNewPriority( prioritizedKey, markerKey, waitKey,
            priorityCounterKey, ARGV[4] == '1', priority, jobId, isPausedOrMaxed)
    end
    rcall("HSET", jobKey, "priority", priority)
    return 0
else
    return -1
end
`,keys:7};e.s(["changePriority",0,t2],21057),e.i(21057);let t3={name:"cleanJobsInSet",content:`--[[
  Remove jobs from the specific set.
  Input:
    KEYS[1]  set key,
    KEYS[2]  events stream key
    KEYS[3]  repeat key
    ARGV[1]  jobKey prefix
    ARGV[2]  timestamp
    ARGV[3]  limit the number of jobs to be removed. 0 is unlimited
    ARGV[4]  set name, can be any of 'wait', 'active', 'paused', 'delayed', 'completed', or 'failed'
]]
local rcall = redis.call
local repeatKey = KEYS[3]
local rangeStart = 0
local rangeEnd = -1
local limit = tonumber(ARGV[3])
-- If we're only deleting _n_ items, avoid retrieving all items
-- for faster performance
--
-- Start from the tail of the list, since that's where oldest elements
-- are generally added for FIFO lists
if limit > 0 then
  rangeStart = -1 - limit + 1
  rangeEnd = -1
end
-- Includes
--[[
  Function to clean job list.
  Returns jobIds and deleted count number.
]]
-- Includes
--[[
  Function to get the latest saved timestamp.
]]
local function getTimestamp(jobKey, attributes)
  if #attributes == 1 then
    return rcall("HGET", jobKey, attributes[1])
  end
  local jobTs
  for _, ts in ipairs(rcall("HMGET", jobKey, unpack(attributes))) do
    if (ts) then
      jobTs = ts
      break
    end
  end
  return jobTs
end
--[[
  Function to check if the job belongs to a job scheduler and
  current delayed job matches with jobId
]]
local function isJobSchedulerJob(jobId, jobKey, jobSchedulersKey)
  local repeatJobKey = rcall("HGET", jobKey, "rjk")
  if repeatJobKey  then
    local prevMillis = rcall("ZSCORE", jobSchedulersKey, repeatJobKey)
    if prevMillis then
      local currentDelayedJobId = "repeat:" .. repeatJobKey .. ":" .. prevMillis
      return jobId == currentDelayedJobId
    end
  end
  return false
end
--[[
  Function to remove job.
]]
-- Includes
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
local function cleanList(listKey, jobKeyPrefix, rangeStart, rangeEnd,
  timestamp, isWaiting, jobSchedulersKey)
  local jobs = rcall("LRANGE", listKey, rangeStart, rangeEnd)
  local deleted = {}
  local deletedCount = 0
  local jobTS
  local deletionMarker = ''
  local jobIdsLen = #jobs
  for i, job in ipairs(jobs) do
    if limit > 0 and deletedCount >= limit then
      break
    end
    local jobKey = jobKeyPrefix .. job
    if (isWaiting or rcall("EXISTS", jobKey .. ":lock") == 0) and
      not isJobSchedulerJob(job, jobKey, jobSchedulersKey) then
      -- Find the right timestamp of the job to compare to maxTimestamp:
      -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
      -- * processedOn represents when the job was last attempted, but it doesn't get populated until
      --   the job is first tried
      -- * timestamp is the original job submission time
      -- Fetch all three of these (in that order) and use the first one that is set so that we'll leave jobs
      -- that have been active within the grace period:
      jobTS = getTimestamp(jobKey, {"finishedOn", "processedOn", "timestamp"})
      if (not jobTS or jobTS <= timestamp) then
        -- replace the entry with a deletion marker; the actual deletion will
        -- occur at the end of the script
        rcall("LSET", listKey, rangeEnd - jobIdsLen + i, deletionMarker)
        removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]])
        deletedCount = deletedCount + 1
        table.insert(deleted, job)
      end
    end
  end
  rcall("LREM", listKey, 0, deletionMarker)
  return {deleted, deletedCount}
end
--[[
  Function to clean job set.
  Returns jobIds and deleted count number.
]] 
-- Includes
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  We use ZRANGEBYSCORE to make the case where we're deleting a limited number
  of items in a sorted set only run a single iteration. If we simply used
  ZRANGE, we may take a long time traversing through jobs that are within the
  grace period.
]]
local function getJobsInZset(zsetKey, rangeEnd, limit)
  if limit > 0 then
    return rcall("ZRANGEBYSCORE", zsetKey, 0, rangeEnd, "LIMIT", 0, limit)
  else
    return rcall("ZRANGEBYSCORE", zsetKey, 0, rangeEnd)
  end
end
local function cleanSet(
    setKey,
    jobKeyPrefix,
    rangeEnd,
    timestamp,
    limit,
    attributes,
    isFinished,
    jobSchedulersKey)
    local jobs = getJobsInZset(setKey, rangeEnd, limit)
    local deleted = {}
    local deletedCount = 0
    local jobTS
    for i, job in ipairs(jobs) do
        if limit > 0 and deletedCount >= limit then
            break
        end
        local jobKey = jobKeyPrefix .. job
        -- Extract a Job Scheduler Id from jobId ("repeat:job-scheduler-id:millis") 
        -- and check if it is in the scheduled jobs
        if not (jobSchedulersKey and isJobSchedulerJob(job, jobKey, jobSchedulersKey)) then
            if isFinished then
                removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]] )
                deletedCount = deletedCount + 1
                table.insert(deleted, job)
            else
                -- * finishedOn says when the job was completed, but it isn't set unless the job has actually completed
                jobTS = getTimestamp(jobKey, attributes)
                if (not jobTS or jobTS <= timestamp) then
                    removeJob(job, true, jobKeyPrefix, true --[[remove debounce key]] )
                    deletedCount = deletedCount + 1
                    table.insert(deleted, job)
                end
            end
        end
    end
    if (#deleted > 0) then
        for from, to in batches(#deleted, 7000) do
            rcall("ZREM", setKey, unpack(deleted, from, to))
        end
    end
    return {deleted, deletedCount}
end
local result
if ARGV[4] == "active" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], false --[[ hasFinished ]],
                      repeatKey)
elseif ARGV[4] == "delayed" then
  rangeEnd = "+inf"
  result = cleanSet(KEYS[1], ARGV[1], rangeEnd, ARGV[2], limit,
                    {"processedOn", "timestamp"}, false  --[[ hasFinished ]], repeatKey)
elseif ARGV[4] == "prioritized" then
  rangeEnd = "+inf"
  result = cleanSet(KEYS[1], ARGV[1], rangeEnd, ARGV[2], limit,
                    {"timestamp"}, false  --[[ hasFinished ]], repeatKey)
elseif ARGV[4] == "wait" or ARGV[4] == "paused" then
  result = cleanList(KEYS[1], ARGV[1], rangeStart, rangeEnd, ARGV[2], true --[[ hasFinished ]],
                      repeatKey)
else
  rangeEnd = ARGV[2]
  -- No need to pass repeat key as in that moment job won't be related to a job scheduler
  result = cleanSet(KEYS[1], ARGV[1], rangeEnd, ARGV[2], limit,
                    {"finishedOn"}, true  --[[ hasFinished ]])
end
rcall("XADD", KEYS[2], "*", "event", "cleaned", "count", result[2])
return result[1]
`,keys:3};e.s(["cleanJobsInSet",0,t3],41381),e.i(41381);let t4={name:"drain",content:`--[[
  Drains the queue, removes all jobs that are waiting
  or delayed, but not active, completed or failed
  Input:
    KEYS[1] 'wait',
    KEYS[2] 'paused'
    KEYS[3] 'delayed'
    KEYS[4] 'prioritized'
    KEYS[5] 'jobschedulers' (repeat)
    ARGV[1]  queue key prefix
    ARGV[2]  should clean delayed jobs
]]
local rcall = redis.call
local queueBaseKey = ARGV[1]
--[[
  Functions to remove jobs.
]]
-- Includes
--[[
  Function to filter out jobs to ignore from a table.
]]
local function filterOutJobsToIgnore(jobs, jobsToIgnore)
  local filteredJobs = {}
  for i = 1, #jobs do
    if not jobsToIgnore[jobs[i]] then
      table.insert(filteredJobs, jobs[i])
    end
  end
  return filteredJobs
end
--[[
  Functions to remove jobs.
]]
-- Includes
--[[
  Function to remove job.
]]
-- Includes
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
local function removeJobs(keys, hard, baseKey, max)
  for i, key in ipairs(keys) do
    removeJob(key, hard, baseKey, true --[[remove debounce key]])
  end
  return max - #keys
end
local function getListItems(keyName, max)
  return rcall('LRANGE', keyName, 0, max - 1)
end
local function removeListJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getListItems(keyName, max)
  if jobsToIgnore then
    jobs = filterOutJobsToIgnore(jobs, jobsToIgnore)
  end
  local count = removeJobs(jobs, hard, baseKey, max)
  rcall("LTRIM", keyName, #jobs, -1)
  return count
end
-- Includes
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  Function to get ZSet items.
]]
local function getZSetItems(keyName, max)
  return rcall('ZRANGE', keyName, 0, max - 1)
end
local function removeZSetJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getZSetItems(keyName, max)
  if jobsToIgnore then
    jobs = filterOutJobsToIgnore(jobs, jobsToIgnore)
  end
  local count = removeJobs(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    for from, to in batches(#jobs, 7000) do
      rcall("ZREM", keyName, unpack(jobs, from, to))
    end
  end
  return count
end
-- We must not remove delayed jobs if they are associated to a job scheduler.
local scheduledJobs = {}
local jobSchedulers = rcall("ZRANGE", KEYS[5], 0, -1, "WITHSCORES")
-- For every job scheduler, get the current delayed job id.
for i = 1, #jobSchedulers, 2 do
    local jobSchedulerId = jobSchedulers[i]
    local jobSchedulerMillis = jobSchedulers[i + 1]
    local delayedJobId = "repeat:" .. jobSchedulerId .. ":" .. jobSchedulerMillis
    scheduledJobs[delayedJobId] = true
end
removeListJobs(KEYS[1], true, queueBaseKey, 0, scheduledJobs) -- wait
removeListJobs(KEYS[2], true, queueBaseKey, 0, scheduledJobs) -- paused
if ARGV[2] == "1" then
  removeZSetJobs(KEYS[3], true, queueBaseKey, 0, scheduledJobs) -- delayed
end
removeZSetJobs(KEYS[4], true, queueBaseKey, 0, scheduledJobs) -- prioritized
`,keys:5};e.s(["drain",0,t4],46888),e.i(46888);let t6={name:"extendLock",content:`--[[
  Extend lock and removes the job from the stalled set.
  Input:
    KEYS[1] 'lock',
    KEYS[2] 'stalled'
    ARGV[1]  token
    ARGV[2]  lock duration in milliseconds
    ARGV[3]  jobid
  Output:
    "1" if lock extended successfully.
]]
local rcall = redis.call
if rcall("GET", KEYS[1]) == ARGV[1] then
  --   if rcall("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "XX") then
  if rcall("SET", KEYS[1], ARGV[1], "PX", ARGV[2]) then
    rcall("SREM", KEYS[2], ARGV[3])
    return 1
  end
end
return 0
`,keys:2};e.s(["extendLock",0,t6],56111),e.i(56111);let t5={name:"extendLocks",content:`--[[
  Extend locks for multiple jobs and remove them from the stalled set if successful.
  Return the list of job IDs for which the operation failed.
  KEYS[1] = stalled key
  ARGV[1] = baseKey
  ARGV[2] = tokens
  ARGV[3] = jobIds
  ARGV[4] = lockDuration (ms)
  Output:
    An array of failed job IDs. If empty, all succeeded.
]]
local rcall = redis.call
local stalledKey = KEYS[1]
local baseKey = ARGV[1]
local tokens = cmsgpack.unpack(ARGV[2])
local jobIds = cmsgpack.unpack(ARGV[3])
local lockDuration = ARGV[4]
local jobCount = #jobIds
local failedJobs = {}
for i = 1, jobCount, 1 do
    local lockKey = baseKey .. jobIds[i] .. ':lock'
    local jobId = jobIds[i]
    local token = tokens[i]
    local currentToken = rcall("GET", lockKey)
    if currentToken then
        if currentToken == token then
            local setResult = rcall("SET", lockKey, token, "PX", lockDuration)
            if setResult then
                rcall("SREM", stalledKey, jobId)
            else
                table.insert(failedJobs, jobId)
            end
        else
            table.insert(failedJobs, jobId)
        end
    else
        table.insert(failedJobs, jobId)
    end
end
return failedJobs
`,keys:1};e.s(["extendLocks",0,t5],46003),e.i(46003);let t8={name:"getCounts",content:`--[[
  Get counts per provided states
    Input:
      KEYS[1]    'prefix'
      ARGV[1...] types
]]
local rcall = redis.call;
local prefix = KEYS[1]
local results = {}
for i = 1, #ARGV do
  local stateKey = prefix .. ARGV[i]
  if ARGV[i] == "wait" or ARGV[i] == "paused" then
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        results[#results+1] = count-1
      else
        results[#results+1] = 0
      end
    else
      results[#results+1] = rcall("LLEN", stateKey)
    end
  elseif ARGV[i] == "active" then
    results[#results+1] = rcall("LLEN", stateKey)
  else
    results[#results+1] = rcall("ZCARD", stateKey)
  end
end
return results
`,keys:1};e.s(["getCounts",0,t8],19884),e.i(19884);let t9={name:"getCountsPerPriority",content:`--[[
  Get counts per provided states
    Input:
      KEYS[1] wait key
      KEYS[2] prioritized key
      ARGV[1...] priorities
]]
local rcall = redis.call
local results = {}
local waitKey = KEYS[1]
local prioritizedKey = KEYS[2]
for i = 1, #ARGV do
  local priority = tonumber(ARGV[i])
  if priority == 0 then
    results[#results+1] = rcall("LLEN", waitKey)
  else
    results[#results+1] = rcall("ZCOUNT", prioritizedKey,
      priority * 0x100000000, (priority + 1)  * 0x100000000 - 1)
  end
end
return results
`,keys:2};e.s(["getCountsPerPriority",0,t9],85891),e.i(85891);let t7={name:"getDependencyCounts",content:`--[[
  Get counts per child states
    Input:
      KEYS[1]    processed key
      KEYS[2]    unprocessed key
      KEYS[3]    ignored key
      KEYS[4]    failed key
      ARGV[1...] types
]]
local rcall = redis.call;
local processedKey = KEYS[1]
local unprocessedKey = KEYS[2]
local ignoredKey = KEYS[3]
local failedKey = KEYS[4]
local results = {}
for i = 1, #ARGV do
  if ARGV[i] == "processed" then
    results[#results+1] = rcall("HLEN", processedKey)
  elseif ARGV[i] == "unprocessed" then
    results[#results+1] = rcall("SCARD", unprocessedKey)
  elseif ARGV[i] == "ignored" then
    results[#results+1] = rcall("HLEN", ignoredKey)
  else
    results[#results+1] = rcall("ZCARD", failedKey)
  end
end
return results
`,keys:4};e.s(["getDependencyCounts",0,t7],64623),e.i(64623);let re={name:"getJobScheduler",content:`--[[
  Get job scheduler record.
  Input:
    KEYS[1] 'repeat' key
    ARGV[1] id
]]
local rcall = redis.call
local jobSchedulerKey = KEYS[1] .. ":" .. ARGV[1]
local score = rcall("ZSCORE", KEYS[1], ARGV[1])
if score then
  return {rcall("HGETALL", jobSchedulerKey), score} -- get job data
end
return {nil, nil}
`,keys:1};e.s(["getJobScheduler",0,re],33429),e.i(33429);let rt={name:"getJobs",content:`--[[
  Get jobs (id + data) for the provided states.
  Job ids and their hashes are read in the same script so that ids whose hash
  disappears after the id is read (but before the job is loaded) do not appear
  in the result set. Ids without a job hash (for example the deprecated wait
  list marker entry stored in the list) are skipped. For bounded ranges the
  script iterates forward using the range offset as a cursor to backfill
  skipped ids, preserving the requested page size when possible.
    Input:
      KEYS[1]    'prefix'
      ARGV[1]    start
      ARGV[2]    end
      ARGV[3]    asc ('1' | '0')
      ARGV[4]    max iterations (backfill bound)
      ARGV[5...] types
    Output:
      results grouped per requested type; each entry is a
      {jobId, {field, value, ...}} tuple
]]
local rcall = redis.call
local prefix = KEYS[1]
local rangeStart = tonumber(ARGV[1])
local rangeEnd = tonumber(ARGV[2])
local asc = ARGV[3] == "1"
local max_iterations = tonumber(ARGV[4])
local results = {}
local function isListType(stateType)
  return stateType == "wait" or stateType == "paused" or stateType == "active"
end
-- Fetch a slice of ids for the given state respecting the requested order.
local function fetchIds(stateKey, stateType, sliceStart, sliceEnd, listLength)
  if isListType(stateType) then
    if asc then
      local modifiedRangeStart
      local modifiedRangeEnd
      if sliceStart == -1 then
        modifiedRangeStart = 0
      else
        modifiedRangeStart = -(sliceStart + 1)
      end
      if sliceEnd == -1 then
        modifiedRangeEnd = 0
      else
        modifiedRangeEnd = -(sliceEnd + 1)
      end
      -- Ascending list slices use negative indexes. When the whole window is
      -- beyond the list length Redis clamps both indexes to 0 and LRANGE would
      -- return the head element, so guard against out-of-range slices with LLEN.
      if listLength ~= nil and sliceStart >= 0 and sliceEnd >= 0 and sliceStart >= listLength then
        return {}
      end
      local ids = rcall("LRANGE", stateKey, modifiedRangeEnd, modifiedRangeStart)
      local reversed = {}
      for i = #ids, 1, -1 do
        reversed[#reversed + 1] = ids[i]
      end
      return reversed
    else
      return rcall("LRANGE", stateKey, sliceStart, sliceEnd)
    end
  else
    if asc then
      return rcall("ZRANGE", stateKey, sliceStart, sliceEnd)
    else
      return rcall("ZREVRANGE", stateKey, sliceStart, sliceEnd)
    end
  end
end
-- Fetch the job hash for an id and append it when present.
local function appendJob(entries, jobId)
  local jobData = rcall("HGETALL", prefix .. jobId)
  if #jobData > 0 then
    entries[#entries + 1] = {jobId, jobData}
  end
end
local function cleanupDeprecatedMarker(stateKey, stateType)
  if stateType == "wait" or stateType == "paused" then
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        return count - 1
      end
      return 0
    end
  end
end
local function collectJobs(stateKey, stateType)
  local entries = {}
  local listLength
  local cleanedListLength = cleanupDeprecatedMarker(stateKey, stateType)
  if asc and isListType(stateType) and rangeStart >= 0 and rangeEnd >= 0 then
    if cleanedListLength ~= nil then
      listLength = cleanedListLength
    else
      listLength = rcall("LLEN", stateKey)
    end
  end
  -- Unbounded or negative ranges: fetch the exact window and skip missing ids.
  if rangeStart < 0 or rangeEnd < 0 then
    local ids = fetchIds(stateKey, stateType, rangeStart, rangeEnd, listLength)
    for i = 1, #ids do
      appendJob(entries, ids[i])
    end
    return entries
  end
  -- Bounded range: iterate forward to backfill skipped ids.
  local needed = rangeEnd - rangeStart + 1
  local cursor = rangeStart
  local iterations = 0
  while #entries < needed and iterations < max_iterations do
    local ids = fetchIds(stateKey, stateType, cursor, cursor + needed - 1, listLength)
    if #ids == 0 then
      break
    end
    for i = 1, #ids do
      if #entries >= needed then
        break
      end
      appendJob(entries, ids[i])
    end
    cursor = cursor + #ids
    iterations = iterations + 1
  end
  return entries
end
for i = 5, #ARGV do
  local stateType = ARGV[i]
  local stateKey = prefix .. stateType
  results[#results + 1] = collectJobs(stateKey, stateType)
end
return results
`,keys:1};e.s(["getJobs",0,rt],55638),e.i(55638);let rr={name:"getMetrics",content:`--[[
  Get metrics
  Input:
    KEYS[1] 'metrics' key
    KEYS[2] 'metrics data' key
    ARGV[1] start index
    ARGV[2] end index
]]
local rcall = redis.call;
local metricsKey = KEYS[1]
local dataKey = KEYS[2]
local metrics = rcall("HMGET", metricsKey, "count", "prevTS", "prevCount")
local data = rcall("LRANGE", dataKey, tonumber(ARGV[1]), tonumber(ARGV[2]))
local numPoints = rcall("LLEN", dataKey)
return {metrics, data, numPoints}
`,keys:2};e.s(["getMetrics",0,rr],36069),e.i(36069);let rn={name:"getRanges",content:`--[[
  Get job ids per provided states
    Input:
      KEYS[1]    'prefix'
      ARGV[1]    start
      ARGV[2]    end
      ARGV[3]    asc
      ARGV[4...] types
]]
local rcall = redis.call
local prefix = KEYS[1]
local rangeStart = tonumber(ARGV[1])
local rangeEnd = tonumber(ARGV[2])
local asc = ARGV[3]
local results = {}
local function getRangeInList(listKey, asc, rangeStart, rangeEnd, results)
  if asc == "1" then
    local modifiedRangeStart
    local modifiedRangeEnd
    if rangeStart == -1 then
      modifiedRangeStart = 0
    else
      modifiedRangeStart = -(rangeStart + 1)
    end
    if rangeEnd == -1 then
      modifiedRangeEnd = 0
    else
      modifiedRangeEnd = -(rangeEnd + 1)
    end
    results[#results+1] = rcall("LRANGE", listKey,
      modifiedRangeEnd,
      modifiedRangeStart)
  else
    results[#results+1] = rcall("LRANGE", listKey, rangeStart, rangeEnd)
  end
end
for i = 4, #ARGV do
  local stateKey = prefix .. ARGV[i]
  if ARGV[i] == "wait" or ARGV[i] == "paused" then
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local marker = rcall("LINDEX", stateKey, -1)
    if marker and string.sub(marker, 1, 2) == "0:" then
      local count = rcall("LLEN", stateKey)
      if count > 1 then
        rcall("RPOP", stateKey)
        getRangeInList(stateKey, asc, rangeStart, rangeEnd, results)
      else
        results[#results+1] = {}
      end
    else
      getRangeInList(stateKey, asc, rangeStart, rangeEnd, results)
    end
  elseif ARGV[i] == "active" then
    getRangeInList(stateKey, asc, rangeStart, rangeEnd, results)
  else
    if asc == "1" then
      results[#results+1] = rcall("ZRANGE", stateKey, rangeStart, rangeEnd)
    else
      results[#results+1] = rcall("ZREVRANGE", stateKey, rangeStart, rangeEnd)
    end
  end
end
return results
`,keys:1};e.s(["getRanges",0,rn],40615),e.i(40615);let ri={name:"getRateLimitTtl",content:`--[[
  Get rate limit ttl
    Input:
      KEYS[1] 'limiter'
      KEYS[2] 'meta'
      ARGV[1] maxJobs
]]
local rcall = redis.call
-- Includes
--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs and maxJobs <= tonumber(rcall("GET", rateLimiterKey) or 0) then
    local pttl = rcall("PTTL", rateLimiterKey)
    if pttl == 0 then
      rcall("DEL", rateLimiterKey)
    end
    if pttl > 0 then
      return pttl
    end
  end
  return 0
end
local rateLimiterKey = KEYS[1]
if ARGV[1] ~= "0" then
  return getRateLimitTTL(tonumber(ARGV[1]), rateLimiterKey)
else
  local rateLimitMax = rcall("HGET", KEYS[2], "max")
  if rateLimitMax then
    return getRateLimitTTL(tonumber(rateLimitMax), rateLimiterKey)
  end
  return rcall("PTTL", rateLimiterKey)
end
`,keys:2};e.s(["getRateLimitTtl",0,ri],95884),e.i(95884);let ra={name:"getState",content:`--[[
  Get a job state
  Input: 
    KEYS[1] 'completed' key,
    KEYS[2] 'failed' key
    KEYS[3] 'delayed' key
    KEYS[4] 'active' key
    KEYS[5] 'wait' key
    KEYS[6] 'paused' key
    KEYS[7] 'waiting-children' key
    KEYS[8] 'prioritized' key
    ARGV[1] job id
  Output:
    'completed'
    'failed'
    'delayed'
    'active'
    'prioritized'
    'waiting'
    'waiting-children'
    'unknown'
]]
local rcall = redis.call
if rcall("ZSCORE", KEYS[1], ARGV[1]) then
  return "completed"
end
if rcall("ZSCORE", KEYS[2], ARGV[1]) then
  return "failed"
end
if rcall("ZSCORE", KEYS[3], ARGV[1]) then
  return "delayed"
end
if rcall("ZSCORE", KEYS[8], ARGV[1]) then
  return "prioritized"
end
-- Includes
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local active_items = rcall("LRANGE", KEYS[4] , 0, -1)
if checkItemInList(active_items, ARGV[1]) ~= nil then
  return "active"
end
local wait_items = rcall("LRANGE", KEYS[5] , 0, -1)
if checkItemInList(wait_items, ARGV[1]) ~= nil then
  return "waiting"
end
local paused_items = rcall("LRANGE", KEYS[6] , 0, -1)
if checkItemInList(paused_items, ARGV[1]) ~= nil then
  return "waiting"
end
if rcall("ZSCORE", KEYS[7], ARGV[1]) then
  return "waiting-children"
end
return "unknown"
`,keys:8};e.s(["getState",0,ra],61570),e.i(61570);let rs={name:"getStateV2",content:`--[[
  Get a job state
  Input: 
    KEYS[1] 'completed' key,
    KEYS[2] 'failed' key
    KEYS[3] 'delayed' key
    KEYS[4] 'active' key
    KEYS[5] 'wait' key
    KEYS[6] 'paused' key
    KEYS[7] 'waiting-children' key
    KEYS[8] 'prioritized' key
    ARGV[1] job id
  Output:
    'completed'
    'failed'
    'delayed'
    'active'
    'waiting'
    'waiting-children'
    'unknown'
]]
local rcall = redis.call
if rcall("ZSCORE", KEYS[1], ARGV[1]) then
  return "completed"
end
if rcall("ZSCORE", KEYS[2], ARGV[1]) then
  return "failed"
end
if rcall("ZSCORE", KEYS[3], ARGV[1]) then
  return "delayed"
end
if rcall("ZSCORE", KEYS[8], ARGV[1]) then
  return "prioritized"
end
if rcall("LPOS", KEYS[4] , ARGV[1]) then
  return "active"
end
if rcall("LPOS", KEYS[5] , ARGV[1]) then
  return "waiting"
end
if rcall("LPOS", KEYS[6] , ARGV[1]) then
  return "waiting"
end
if rcall("ZSCORE", KEYS[7] , ARGV[1]) then
  return "waiting-children"
end
return "unknown"
`,keys:8};e.s(["getStateV2",0,rs],6789),e.i(6789);let ro={name:"isFinished",content:`--[[
  Checks if a job is finished (.i.e. is in the completed or failed set)
  Input: 
    KEYS[1] completed key
    KEYS[2] failed key
    KEYS[3] job key
    ARGV[1] job id
    ARGV[2] return value?
  Output:
    0 - Not finished.
    1 - Completed.
    2 - Failed.
   -1 - Missing job. 
]]
local rcall = redis.call
if rcall("EXISTS", KEYS[3]) ~= 1 then
  if ARGV[2] == "1" then
    return {-1,"Missing key for job " .. KEYS[3] .. ". isFinished"}
  end  
  return -1
end
if rcall("ZSCORE", KEYS[1], ARGV[1]) then
  if ARGV[2] == "1" then
    local returnValue = rcall("HGET", KEYS[3], "returnvalue")
    return {1,returnValue}
  end
  return 1
end
if rcall("ZSCORE", KEYS[2], ARGV[1]) then
  if ARGV[2] == "1" then
    local failedReason = rcall("HGET", KEYS[3], "failedReason")
    return {2,failedReason}
  end
  return 2
end
if ARGV[2] == "1" then
  return {0}
end
return 0
`,keys:3};e.s(["isFinished",0,ro],71707),e.i(71707);let rl={name:"isJobInList",content:`--[[
  Checks if job is in a given list.
  Input:
    KEYS[1]
    ARGV[1]
  Output:
    1 if element found in the list.
]]
-- Includes
--[[
  Function to check if an item belongs to a list.
]]
local function checkItemInList(list, item)
  for _, v in pairs(list) do
    if v == item then
      return 1
    end
  end
  return nil
end
local items = redis.call("LRANGE", KEYS[1] , 0, -1)
return checkItemInList(items, ARGV[1])
`,keys:1};e.s(["isJobInList",0,rl],68134),e.i(68134);let rd={name:"isMaxed",content:`--[[
  Checks if queue is maxed.
  Input:
    KEYS[1] meta key
    KEYS[2] active key
  Output:
    1 if element found in the list.
]]
local rcall = redis.call
-- Includes
--[[
  Function to check if queue is maxed or not.
]]
local function isQueueMaxed(queueMetaKey, activeKey)
  local maxConcurrency = rcall("HGET", queueMetaKey, "concurrency")
  if maxConcurrency then
    local activeCount = rcall("LLEN", activeKey)
    if activeCount >= tonumber(maxConcurrency) then
      return true
    end
  end
  return false
end
return isQueueMaxed(KEYS[1], KEYS[2])
`,keys:2};e.s(["isMaxed",0,rd],79499),e.i(79499);let rc={name:"moveJobFromActiveToWait",content:`--[[
  Function to move job from active state to wait.
  Input:
    KEYS[1]  active key
    KEYS[2]  wait key
    KEYS[3]  stalled key
    KEYS[4]  paused key
    KEYS[5]  meta key
    KEYS[6]  limiter key
    KEYS[7]  prioritized key
    KEYS[8]  marker key
    KEYS[9]  event key
    ARGV[1] job id
    ARGV[2] lock token
    ARGV[3] job id key
]]
local rcall = redis.call
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to push back job considering priority in front of same prioritized jobs.
]]
local function pushBackJobWithPriority(prioritizedKey, priority, jobId)
  -- in order to put it at front of same prioritized jobs
  -- we consider prioritized counter as 0
  local score = priority * 0x100000000
  rcall("ZADD", prioritizedKey, score, jobId)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function removeLock(jobKey, stalledKey, token, jobId)
  if token ~= "0" then
    local lockKey = jobKey .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if lockToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", stalledKey, jobId)
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end
  return 0
end
local jobId = ARGV[1]
local token = ARGV[2]
local jobKey = ARGV[3]
if rcall("EXISTS", jobKey) == 0 then
  return -1
end
local errorCode = removeLock(jobKey, KEYS[3], token, jobId)
if errorCode < 0 then
  return errorCode
end
local metaKey = KEYS[5]
local removed = rcall("LREM", KEYS[1], 1, jobId)
if removed > 0 then
  local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[1])
  local priority = tonumber(rcall("HGET", ARGV[3], "priority")) or 0
  if priority > 0 then
    pushBackJobWithPriority(KEYS[7], priority, jobId)
  else
    addJobInTargetList(KEYS[2], KEYS[8], "RPUSH", isPausedOrMaxed, jobId)
  end
  local maxEvents = getOrSetMaxEvents(metaKey)
  -- Emit waiting event
  rcall("XADD", KEYS[9], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
    "jobId", jobId, "prev", "active")
end
local pttl = rcall("PTTL", KEYS[6])
if pttl > 0 then
  return pttl
else
  return 0
end
`,keys:9};e.s(["moveJobFromActiveToWait",0,rc],91017),e.i(91017);let ru={name:"moveJobsToWait",content:`--[[
  Move completed, failed or delayed jobs to wait.
  Note: Does not support jobs with priorities.
  Input:
    KEYS[1] base key
    KEYS[2] events stream
    KEYS[3] state key (failed, completed, delayed)
    KEYS[4] 'wait'
    KEYS[5] 'paused'
    KEYS[6] 'meta'
    KEYS[7] 'active'
    KEYS[8] 'marker'
    ARGV[1] count
    ARGV[2] timestamp
    ARGV[3] prev state
  Output:
    1  means the operation is not completed
    0  means the operation is completed
]]
local maxCount = tonumber(ARGV[1])
local timestamp = tonumber(ARGV[2])
local rcall = redis.call;
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local metaKey = KEYS[6]
local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[7])
local jobs = rcall('ZRANGEBYSCORE', KEYS[3], 0, timestamp, 'LIMIT', 0, maxCount)
if (#jobs > 0) then
    if ARGV[3] == "failed" then
        for i, key in ipairs(jobs) do
            local jobKey = KEYS[1] .. key
            rcall("HDEL", jobKey, "finishedOn", "processedOn", "failedReason")
        end
    elseif ARGV[3] == "completed" then
        for i, key in ipairs(jobs) do
            local jobKey = KEYS[1] .. key
            rcall("HDEL", jobKey, "finishedOn", "processedOn", "returnvalue")
        end
    end
    local maxEvents = getOrSetMaxEvents(metaKey)
    for i, key in ipairs(jobs) do
        -- Emit waiting event
        rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*", "event",
              "waiting", "jobId", key, "prev", ARGV[3]);
    end
    for from, to in batches(#jobs, 7000) do
        rcall("ZREM", KEYS[3], unpack(jobs, from, to))
        rcall("LPUSH", KEYS[4], unpack(jobs, from, to))
    end
    addBaseMarkerIfNeeded(KEYS[8], isPausedOrMaxed)
end
maxCount = maxCount - #jobs
if (maxCount <= 0) then return 1 end
return 0
`,keys:8};e.s(["moveJobsToWait",0,ru],73652),e.i(73652);let rh={name:"moveStalledJobsToWait",content:`--[[
  Move stalled jobs to wait.
    Input:
      KEYS[1] 'stalled' (SET)
      KEYS[2] 'wait',   (LIST)
      KEYS[3] 'active', (LIST)
      KEYS[4] 'stalled-check', (KEY)
      KEYS[5] 'meta', (KEY)
      KEYS[6] 'paused', (LIST)
      KEYS[7] 'marker'
      KEYS[8] 'event stream' (STREAM)
      KEYS[9] 'repeat' key
      ARGV[1]  Max stalled job count
      ARGV[2]  queue.toKey('')
      ARGV[3]  timestamp
      ARGV[4]  max check time
    Events:
      'stalled' with stalled job id.
]]
local rcall = redis.call
-- Includes
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  Function to move job to wait to be picked up by a waiting worker.
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveJobToWait(metaKey, activeKey, waitKey, pausedKey, markerKey, eventStreamKey,
  jobId, pushCmd)
  local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
  addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId", jobId, 'prev', 'active')
end
--[[
  Function to trim events, default 10000.
]]
-- Includes
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
local function trimEvents(metaKey, eventStreamKey)
  local maxEvents = getOrSetMaxEvents(metaKey)
  if maxEvents then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents)
  else
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", 10000)
  end
end
local stalledKey = KEYS[1]
local waitKey = KEYS[2]
local activeKey = KEYS[3]
local stalledCheckKey = KEYS[4]
local metaKey = KEYS[5]
local pausedKey = KEYS[6]
local markerKey = KEYS[7]
local eventStreamKey = KEYS[8]
local repeatKey = KEYS[9]
local maxStalledJobCount = tonumber(ARGV[1])
local queueKeyPrefix = ARGV[2]
local timestamp = ARGV[3]
local maxCheckTime = ARGV[4]
if rcall("EXISTS", stalledCheckKey) == 1 then
    return {}
end
rcall("SET", stalledCheckKey, timestamp, "PX", maxCheckTime)
-- Trim events before emitting them to avoid trimming events emitted in this script
trimEvents(metaKey, eventStreamKey)
-- Move all stalled jobs to wait
local stalling = rcall('SMEMBERS', stalledKey)
local stalled = {}
if (#stalling > 0) then
    rcall('DEL', stalledKey)
    -- Remove from active list
    for i, jobId in ipairs(stalling) do
        -- Markers in waitlist DEPRECATED in v5: Remove in v6.
        if string.sub(jobId, 1, 2) == "0:" then
            -- If the jobId is a delay marker ID we just remove it.
            rcall("LREM", activeKey, 1, jobId)
        else
            local jobKey = queueKeyPrefix .. jobId
            -- Check that the lock is also missing, then we can handle this job as really stalled.
            if (rcall("EXISTS", jobKey .. ":lock") == 0) then
                --  Remove from the active queue.
                local removed = rcall("LREM", activeKey, 1, jobId)
                if (removed > 0) then
                    -- If this job has been stalled too many times, such as if it crashes the worker, then fail it.
                    local stalledCount = rcall("HINCRBY", jobKey, "stc", 1)
                    -- Check if this is a repeatable job by looking at job options
                    local jobSchedulerId = rcall("HGET", jobKey, "rjk")
                    local isRepeatableJob = false
                    if jobSchedulerId then
                        local schedulerKey = repeatKey .. ":" .. jobSchedulerId
                        if rcall("EXISTS", schedulerKey) == 1 then
                            isRepeatableJob = true
                        else
                            -- TODO: remove this check in v6, as it is only needed for legacy repeatable jobs
                            -- that stored the scheduler id in the job key but did not create the scheduler hash key
                            local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
                            if prevMillis then
                                isRepeatableJob = true
                            end
                        end
                    end
                    -- Only fail job if it exceeds stall limit AND is not a repeatable job
                    if stalledCount > maxStalledJobCount and not isRepeatableJob then
                        local failedReason = "job stalled more than allowable limit"
                        rcall("HSET", jobKey, "defa", failedReason)
                    end
                    moveJobToWait(metaKey, activeKey, waitKey, pausedKey, markerKey, eventStreamKey, jobId,
                        "RPUSH")
                    -- Emit the stalled event
                    rcall("XADD", eventStreamKey, "*", "event", "stalled", "jobId", jobId)
                    table.insert(stalled, jobId)
                end
            end
        end
    end
end
-- Mark potentially stalled jobs
local active = rcall('LRANGE', activeKey, 0, -1)
if (#active > 0) then
    for from, to in batches(#active, 7000) do
        rcall('SADD', stalledKey, unpack(active, from, to))
    end
end
return stalled
`,keys:9};e.s(["moveStalledJobsToWait",0,rh],43687),e.i(43687);let rp={name:"moveToActive",content:`--[[
  Move next job to be processed to active, lock it and fetch its data. The job
  may be delayed, in that case we need to move it to the delayed set instead.
  This operation guarantees that the worker owns the job during the lock
  expiration time. The worker is responsible of keeping the lock fresh
  so that no other worker picks this job again.
  Input:
    KEYS[1] wait key
    KEYS[2] active key
    KEYS[3] prioritized key
    KEYS[4] stream events key
    KEYS[5] stalled key
    -- Rate limiting
    KEYS[6] rate limiter key
    KEYS[7] delayed key
    -- Delayed jobs
    KEYS[8] paused key
    KEYS[9] meta key
    KEYS[10] pc priority counter
    -- Marker
    KEYS[11] marker key
    -- Arguments
    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] opts
    opts - token - lock token
    opts - lockDuration
    opts - limiter
    opts - name - worker name
]]
local rcall = redis.call
local waitKey = KEYS[1]
local activeKey = KEYS[2]
local eventStreamKey = KEYS[4]
local rateLimiterKey = KEYS[6]
local delayedKey = KEYS[7]
local opts = cmsgpack.unpack(ARGV[3])
-- Includes
--[[
  Function to get queue metadata.
]]
local function getQueueMetadata(queueMetaKey, activeKey, waitKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency", "max", "duration")
  if queueAttributes[1] then
    return true, queueAttributes[3], queueAttributes[4]
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      if activeCount >= tonumber(queueAttributes[2]) then
        return true, queueAttributes[3], queueAttributes[4]
      else
        return false, queueAttributes[3], queueAttributes[4]
      end
    end
  end
  return false, queueAttributes[3], queueAttributes[4]
end
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs and maxJobs <= tonumber(rcall("GET", rateLimiterKey) or 0) then
    local pttl = rcall("PTTL", rateLimiterKey)
    if pttl == 0 then
      rcall("DEL", rateLimiterKey)
    end
    if pttl > 0 then
      return pttl
    end
  end
  return 0
end
--[[
  Function to move job from prioritized state to active.
]]
local function moveJobFromPrioritizedToActive(priorityKey, activeKey, priorityCounterKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    rcall("LPUSH", activeKey, prioritizedJob[1])
    return prioritizedJob[1]
  else
    rcall("DEL", priorityCounterKey)
  end
end
--[[
  Function to move job from wait state to active.
  Input:
    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function prepareJobForProcessing(keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, limiterDuration, markerKey, opts)
  local jobKey = keyPrefix .. jobId
  -- Check if we need to perform rate limiting.
  if maxJobs then
    local isDeferredFailure = rcall("HEXISTS", jobKey, "defa") == 1
    if not isDeferredFailure then
      local jobCounter = tonumber(rcall("INCR", rateLimiterKey))
      if jobCounter == 1 then
        local integerDuration = math.floor(math.abs(limiterDuration))
        rcall("PEXPIRE", rateLimiterKey, integerDuration)
      end
    end
  end
  -- get a lock
  if opts['token'] ~= "0" then
    local lockKey = jobKey .. ':lock'
    rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])
  end
  local optionalValues = {}
  if opts['name'] then
    -- Set "processedBy" field to the worker name
    table.insert(optionalValues, "pb")
    table.insert(optionalValues, opts['name'])
  end
  rcall("XADD", eventStreamKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HMSET", jobKey, "processedOn", processedOn, unpack(optionalValues))
  rcall("HINCRBY", jobKey, "ats", 1)
  addBaseMarkerIfNeeded(markerKey, false)
  -- rate limit delay must be 0 in this case to prevent adding more delay
  -- when job that is moved to active needs to be processed
  return {rcall("HGETALL", jobKey), jobId, 0, 0} -- get job data
end
--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".
     Events:
      'waiting'
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)
    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))
        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local priority =
                tonumber(rcall("HGET", jobKey, "priority")) or 0
            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                local score = getPriorityScore(priority, priorityCounterKey)
                rcall("ZADD", prioritizedKey, score, jobId)
            end
            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
        addBaseMarkerIfNeeded(markerKey, isPaused)
    end
end
local isPausedOrMaxed, rateLimitMax, rateLimitDuration =
    getQueueMetadata(KEYS[9], activeKey, waitKey)
-- Check if there are delayed jobs that we can move to wait.
local markerKey = KEYS[11]
promoteDelayedJobs(delayedKey, markerKey, waitKey, KEYS[3], eventStreamKey, ARGV[1],
                   ARGV[2], KEYS[10], isPausedOrMaxed)
local maxJobs = tonumber(rateLimitMax or (opts['limiter'] and opts['limiter']['max']))
local expireTime = getRateLimitTTL(maxJobs, rateLimiterKey)
-- Check if we are rate limited first.
if expireTime > 0 then return {0, 0, expireTime, 0} end
-- paused or maxed queue
if isPausedOrMaxed then return {0, 0, 0, 0} end
local limiterDuration = (opts['limiter'] and opts['limiter']['duration']) or rateLimitDuration
-- no job ID, try non-blocking move from wait to active
local jobId = rcall("RPOPLPUSH", waitKey, activeKey)
-- Markers in waitlist DEPRECATED in v5: Will be completely removed in v6.
if jobId and string.sub(jobId, 1, 2) == "0:" then
    rcall("LREM", activeKey, 1, jobId)
    jobId = rcall("RPOPLPUSH", waitKey, activeKey)
end
if jobId then
    return prepareJobForProcessing(ARGV[1], rateLimiterKey, eventStreamKey, jobId, ARGV[2],
                                   maxJobs, limiterDuration, markerKey, opts)
else
    jobId = moveJobFromPrioritizedToActive(KEYS[3], activeKey, KEYS[10])
    if jobId then
        return prepareJobForProcessing(ARGV[1], rateLimiterKey, eventStreamKey, jobId, ARGV[2],
                                       maxJobs, limiterDuration, markerKey, opts)
    end
end
-- Return the timestamp for the next delayed job if any.
local nextTimestamp = getNextDelayedTimestamp(delayedKey)
if nextTimestamp ~= nil then return {0, 0, 0, nextTimestamp} end
return {0, 0, 0, 0}
`,keys:11};e.s(["moveToActive",0,rp],10393),e.i(10393);let rm={name:"moveToDelayed",content:`--[[
  Moves job from active to delayed set.
  Input:
    KEYS[1] marker key
    KEYS[2] active key
    KEYS[3] prioritized key
    KEYS[4] delayed key
    KEYS[5] job key
    KEYS[6] events stream
    KEYS[7] meta key
    KEYS[8] stalled key
    KEYS[9] wait key
    KEYS[10] rate limiter key
    KEYS[11] pc priority counter
    ARGV[1] key prefix
    ARGV[2] timestamp
    ARGV[3] the id of the job
    ARGV[4] queue token
    ARGV[5] delay value
    ARGV[6] skip attempt
    ARGV[7] optional job fields to update
    ARGV[8] fetch next?
    ARGV[9] opts
  Output:
    0 - OK
   -1 - Missing job.
   -3 - Job not in active set.
  Events:
    - delayed key.
]]
local rcall = redis.call
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Function to fetch the next job to process.
  Tries to get the next job to avoid an extra roundtrip if the queue is
  not closing and not rate limited.
  Input:
    waitKey - wait list key
    activeKey - active list key
    prioritizedKey - prioritized sorted set key
    eventStreamKey - event stream key
    rateLimiterKey - rate limiter key
    delayedKey - delayed sorted set key
    metaKey - meta hash key
    pcKey - priority counter key
    markerKey - marker key
    prefix - keys prefix
    timestamp - current timestamp
    opts - options table:
      token (required) - lock token used when locking jobs
      lockDuration (required) - lock duration for acquired jobs
      limiter (optional) - rate limiter options table (e.g. { max = number })
]]
-- Includes
--[[
  Function to get queue metadata.
]]
local function getQueueMetadata(queueMetaKey, activeKey, waitKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency", "max", "duration")
  if queueAttributes[1] then
    return true, queueAttributes[3], queueAttributes[4]
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      if activeCount >= tonumber(queueAttributes[2]) then
        return true, queueAttributes[3], queueAttributes[4]
      else
        return false, queueAttributes[3], queueAttributes[4]
      end
    end
  end
  return false, queueAttributes[3], queueAttributes[4]
end
--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs and maxJobs <= tonumber(rcall("GET", rateLimiterKey) or 0) then
    local pttl = rcall("PTTL", rateLimiterKey)
    if pttl == 0 then
      rcall("DEL", rateLimiterKey)
    end
    if pttl > 0 then
      return pttl
    end
  end
  return 0
end
--[[
  Function to move job from prioritized state to active.
]]
local function moveJobFromPrioritizedToActive(priorityKey, activeKey, priorityCounterKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    rcall("LPUSH", activeKey, prioritizedJob[1])
    return prioritizedJob[1]
  else
    rcall("DEL", priorityCounterKey)
  end
end
--[[
  Function to move job from wait state to active.
  Input:
    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function prepareJobForProcessing(keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, limiterDuration, markerKey, opts)
  local jobKey = keyPrefix .. jobId
  -- Check if we need to perform rate limiting.
  if maxJobs then
    local isDeferredFailure = rcall("HEXISTS", jobKey, "defa") == 1
    if not isDeferredFailure then
      local jobCounter = tonumber(rcall("INCR", rateLimiterKey))
      if jobCounter == 1 then
        local integerDuration = math.floor(math.abs(limiterDuration))
        rcall("PEXPIRE", rateLimiterKey, integerDuration)
      end
    end
  end
  -- get a lock
  if opts['token'] ~= "0" then
    local lockKey = jobKey .. ':lock'
    rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])
  end
  local optionalValues = {}
  if opts['name'] then
    -- Set "processedBy" field to the worker name
    table.insert(optionalValues, "pb")
    table.insert(optionalValues, opts['name'])
  end
  rcall("XADD", eventStreamKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HMSET", jobKey, "processedOn", processedOn, unpack(optionalValues))
  rcall("HINCRBY", jobKey, "ats", 1)
  addBaseMarkerIfNeeded(markerKey, false)
  -- rate limit delay must be 0 in this case to prevent adding more delay
  -- when job that is moved to active needs to be processed
  return {rcall("HGETALL", jobKey), jobId, 0, 0} -- get job data
end
--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".
     Events:
      'waiting'
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)
    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))
        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local priority =
                tonumber(rcall("HGET", jobKey, "priority")) or 0
            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                local score = getPriorityScore(priority, priorityCounterKey)
                rcall("ZADD", prioritizedKey, score, jobId)
            end
            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
        addBaseMarkerIfNeeded(markerKey, isPaused)
    end
end
local function fetchNextJob(waitKey, activeKey, prioritizedKey, eventStreamKey,
    rateLimiterKey, delayedKey, metaKey, pcKey, markerKey, prefix,
    timestamp, opts)
    local isPausedOrMaxed, rateLimitMax, rateLimitDuration =
        getQueueMetadata(metaKey, activeKey, waitKey)
    -- Check if there are delayed jobs that can be promoted
    promoteDelayedJobs(delayedKey, markerKey, waitKey, prioritizedKey,
        eventStreamKey, prefix, timestamp, pcKey, isPausedOrMaxed)
    local maxJobs = tonumber(rateLimitMax or (opts['limiter'] and opts['limiter']['max']))
    -- Check if we are rate limited first.
    local expireTime = getRateLimitTTL(maxJobs, rateLimiterKey)
    if expireTime > 0 then
        return {0, 0, expireTime, 0}
    end
    -- paused or maxed queue
    if isPausedOrMaxed then
        return {0, 0, 0, 0}
    end
    local limiterDuration = (opts['limiter'] and opts['limiter']['duration']) or rateLimitDuration
    local jobId = rcall("RPOPLPUSH", waitKey, activeKey)
    if jobId then
        -- Markers in waitlist DEPRECATED in v5: Remove in v6.
        if string.sub(jobId, 1, 2) == "0:" then
            rcall("LREM", activeKey, 1, jobId)
            -- If jobId is special ID 0:delay (delay greater than 0), then there is no job to process
            -- but if ID is 0:0, then there is at least 1 prioritized job to process
            if jobId == "0:0" then
                jobId = moveJobFromPrioritizedToActive(prioritizedKey, activeKey, pcKey)
                return prepareJobForProcessing(prefix, rateLimiterKey,
                    eventStreamKey, jobId, timestamp, maxJobs,
                    limiterDuration, markerKey, opts)
            end
        else
            return prepareJobForProcessing(prefix, rateLimiterKey,
                eventStreamKey, jobId, timestamp, maxJobs,
                limiterDuration, markerKey, opts)
        end
    else
        jobId = moveJobFromPrioritizedToActive(prioritizedKey, activeKey, pcKey)
        if jobId then
            return prepareJobForProcessing(prefix, rateLimiterKey,
                eventStreamKey, jobId, timestamp, maxJobs,
                limiterDuration, markerKey, opts)
        end
    end
    -- Return the timestamp for the next delayed job if any.
    local nextTimestamp = getNextDelayedTimestamp(delayedKey)
    if nextTimestamp ~= nil then
        -- The result is guaranteed to be positive, since the
        -- ZRANGEBYSCORE command would have return a job otherwise.
        return {0, 0, 0, nextTimestamp}
    end
end
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
local function removeLock(jobKey, stalledKey, token, jobId)
  if token ~= "0" then
    local lockKey = jobKey .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if lockToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", stalledKey, jobId)
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end
  return 0
end
--[[
  Function to update a bunch of fields in a job.
]]
local function updateJobFields(jobKey, msgpackedFields)
  if msgpackedFields and #msgpackedFields > 0 then
    local fieldsToUpdate = cmsgpack.unpack(msgpackedFields)
    if fieldsToUpdate then
      rcall("HMSET", jobKey, unpack(fieldsToUpdate))
    end
  end
end
local jobKey = KEYS[5]
local markerKey = KEYS[1]
local metaKey = KEYS[7]
local token = ARGV[4] 
if rcall("EXISTS", jobKey) == 1 then
    local errorCode = removeLock(jobKey, KEYS[8], token, ARGV[3])
    if errorCode < 0 then
        return errorCode
    end
    updateJobFields(jobKey, ARGV[7])
    local delayedKey = KEYS[4]
    local jobId = ARGV[3]
    local delay = tonumber(ARGV[5])
    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)
    if numRemovedElements < 1 then return -3 end
    local score, delayedTimestamp = getDelayedScore(delayedKey, ARGV[2], delay)
    if ARGV[6] == "0" then
        rcall("HINCRBY", jobKey, "atm", 1)
    end
    rcall("HSET", jobKey, "delay", ARGV[5])
    local maxEvents = getOrSetMaxEvents(metaKey)
    rcall("ZADD", delayedKey, score, jobId)
    rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "delayed",
          "jobId", jobId, "delay", delayedTimestamp)
    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[8] == "1") then
        local opts = cmsgpack.unpack(ARGV[9])
        local result = fetchNextJob(KEYS[9], KEYS[2], KEYS[3], KEYS[6],
            KEYS[10], KEYS[4], metaKey, KEYS[11], markerKey,
            ARGV[1], ARGV[2], opts)
        if result and type(result[1]) == "table" then
            return result
        end
    end
    -- Check if we need to push a marker job to wake up sleeping workers.
    addDelayMarkerIfNeeded(markerKey, delayedKey)
    return 0
else
    return -1
end
`,keys:11};e.s(["moveToDelayed",0,rm],32513),e.i(32513);let ry={name:"moveToFinished",content:`--[[
  Move job from active to a finished status (completed or failed)
  A job can only be moved to completed if it was active.
  The job must be locked before it can be moved to a finished status,
  and the lock must be released in this script.
    Input:
      KEYS[1] wait key
      KEYS[2] active key
      KEYS[3] prioritized key
      KEYS[4] event stream key
      KEYS[5] stalled key
      -- Rate limiting
      KEYS[6] rate limiter key
      KEYS[7] delayed key
      KEYS[8] paused key
      KEYS[9] meta key
      KEYS[10] pc priority counter
      KEYS[11] completed/failed key
      KEYS[12] jobId key
      KEYS[13] metrics key
      KEYS[14] marker key
      ARGV[1]  jobId
      ARGV[2]  timestamp
      ARGV[3]  msg property returnvalue / failedReason
      ARGV[4]  return value / failed reason
      ARGV[5]  target (completed/failed)
      ARGV[6]  fetch next?
      ARGV[7]  keys prefix
      ARGV[8]  opts
      ARGV[9]  job fields to update
      opts - token - lock token
      opts - keepJobs
      opts - lockDuration - lock duration in milliseconds
      opts - attempts max attempts
      opts - maxMetricsSize
      opts - fpof - fail parent on fail
      opts - cpof - continue parent on fail
      opts - idof - ignore dependency on fail
      opts - rdof - remove dependency on fail
      opts - name - worker name
    Output:
      0 OK
      -1 Missing key.
      -2 Missing lock.
      -3 Job not in active set
      -4 Job has pending children
      -6 Lock is not owned by this client
      -9 Job has failed children
    Events:
      'completed/failed'
]]
local rcall = redis.call
--- Includes
--[[
  Functions to collect metrics based on a current and previous count of jobs.
  Granularity is fixed at 1 minute.
]]
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
local function collectMetrics(metaKey, dataPointsList, maxDataPoints,
                                 timestamp)
    -- Increment current count
    local count = rcall("HINCRBY", metaKey, "count", 1) - 1
    -- Compute how many data points we need to add to the list, N.
    local prevTS = rcall("HGET", metaKey, "prevTS")
    if not prevTS then
        -- If prevTS is nil, set it to the current timestamp
        rcall("HSET", metaKey, "prevTS", timestamp, "prevCount", 0)
        return
    end
    local N = math.min(math.floor(timestamp / 60000) - math.floor(prevTS / 60000), tonumber(maxDataPoints))
    if N > 0 then
        local delta = count - rcall("HGET", metaKey, "prevCount")
        -- If N > 1, add N-1 zeros to the list
        if N > 1 then
            local points = {}
            points[1] = delta
            for i = 2, N do
                points[i] = 0
            end
            for from, to in batches(#points, 7000) do
                rcall("LPUSH", dataPointsList, unpack(points, from, to))
            end
        else
            -- LPUSH delta to the list
            rcall("LPUSH", dataPointsList, delta)
        end
        -- LTRIM to keep list to its max size
        rcall("LTRIM", dataPointsList, 0, maxDataPoints - 1)
        -- update prev count with current count
        rcall("HSET", metaKey, "prevCount", count, "prevTS", timestamp)
    end
end
--[[
  Function to fetch the next job to process.
  Tries to get the next job to avoid an extra roundtrip if the queue is
  not closing and not rate limited.
  Input:
    waitKey - wait list key
    activeKey - active list key
    prioritizedKey - prioritized sorted set key
    eventStreamKey - event stream key
    rateLimiterKey - rate limiter key
    delayedKey - delayed sorted set key
    metaKey - meta hash key
    pcKey - priority counter key
    markerKey - marker key
    prefix - keys prefix
    timestamp - current timestamp
    opts - options table:
      token (required) - lock token used when locking jobs
      lockDuration (required) - lock duration for acquired jobs
      limiter (optional) - rate limiter options table (e.g. { max = number })
]]
-- Includes
--[[
  Function to get queue metadata.
]]
local function getQueueMetadata(queueMetaKey, activeKey, waitKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency", "max", "duration")
  if queueAttributes[1] then
    return true, queueAttributes[3], queueAttributes[4]
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      if activeCount >= tonumber(queueAttributes[2]) then
        return true, queueAttributes[3], queueAttributes[4]
      else
        return false, queueAttributes[3], queueAttributes[4]
      end
    end
  end
  return false, queueAttributes[3], queueAttributes[4]
end
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
--[[
  Function to get current rate limit ttl.
]]
local function getRateLimitTTL(maxJobs, rateLimiterKey)
  if maxJobs and maxJobs <= tonumber(rcall("GET", rateLimiterKey) or 0) then
    local pttl = rcall("PTTL", rateLimiterKey)
    if pttl == 0 then
      rcall("DEL", rateLimiterKey)
    end
    if pttl > 0 then
      return pttl
    end
  end
  return 0
end
--[[
  Function to move job from prioritized state to active.
]]
local function moveJobFromPrioritizedToActive(priorityKey, activeKey, priorityCounterKey)
  local prioritizedJob = rcall("ZPOPMIN", priorityKey)
  if #prioritizedJob > 0 then
    rcall("LPUSH", activeKey, prioritizedJob[1])
    return prioritizedJob[1]
  else
    rcall("DEL", priorityCounterKey)
  end
end
--[[
  Function to move job from wait state to active.
  Input:
    opts - token - lock token
    opts - lockDuration
    opts - limiter
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function prepareJobForProcessing(keyPrefix, rateLimiterKey, eventStreamKey,
    jobId, processedOn, maxJobs, limiterDuration, markerKey, opts)
  local jobKey = keyPrefix .. jobId
  -- Check if we need to perform rate limiting.
  if maxJobs then
    local isDeferredFailure = rcall("HEXISTS", jobKey, "defa") == 1
    if not isDeferredFailure then
      local jobCounter = tonumber(rcall("INCR", rateLimiterKey))
      if jobCounter == 1 then
        local integerDuration = math.floor(math.abs(limiterDuration))
        rcall("PEXPIRE", rateLimiterKey, integerDuration)
      end
    end
  end
  -- get a lock
  if opts['token'] ~= "0" then
    local lockKey = jobKey .. ':lock'
    rcall("SET", lockKey, opts['token'], "PX", opts['lockDuration'])
  end
  local optionalValues = {}
  if opts['name'] then
    -- Set "processedBy" field to the worker name
    table.insert(optionalValues, "pb")
    table.insert(optionalValues, opts['name'])
  end
  rcall("XADD", eventStreamKey, "*", "event", "active", "jobId", jobId, "prev", "waiting")
  rcall("HMSET", jobKey, "processedOn", processedOn, unpack(optionalValues))
  rcall("HINCRBY", jobKey, "ats", 1)
  addBaseMarkerIfNeeded(markerKey, false)
  -- rate limit delay must be 0 in this case to prevent adding more delay
  -- when job that is moved to active needs to be processed
  return {rcall("HGETALL", jobKey), jobId, 0, 0} -- get job data
end
--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".
     Events:
      'waiting'
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)
    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))
        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local priority =
                tonumber(rcall("HGET", jobKey, "priority")) or 0
            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                local score = getPriorityScore(priority, priorityCounterKey)
                rcall("ZADD", prioritizedKey, score, jobId)
            end
            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
        addBaseMarkerIfNeeded(markerKey, isPaused)
    end
end
local function fetchNextJob(waitKey, activeKey, prioritizedKey, eventStreamKey,
    rateLimiterKey, delayedKey, metaKey, pcKey, markerKey, prefix,
    timestamp, opts)
    local isPausedOrMaxed, rateLimitMax, rateLimitDuration =
        getQueueMetadata(metaKey, activeKey, waitKey)
    -- Check if there are delayed jobs that can be promoted
    promoteDelayedJobs(delayedKey, markerKey, waitKey, prioritizedKey,
        eventStreamKey, prefix, timestamp, pcKey, isPausedOrMaxed)
    local maxJobs = tonumber(rateLimitMax or (opts['limiter'] and opts['limiter']['max']))
    -- Check if we are rate limited first.
    local expireTime = getRateLimitTTL(maxJobs, rateLimiterKey)
    if expireTime > 0 then
        return {0, 0, expireTime, 0}
    end
    -- paused or maxed queue
    if isPausedOrMaxed then
        return {0, 0, 0, 0}
    end
    local limiterDuration = (opts['limiter'] and opts['limiter']['duration']) or rateLimitDuration
    local jobId = rcall("RPOPLPUSH", waitKey, activeKey)
    if jobId then
        -- Markers in waitlist DEPRECATED in v5: Remove in v6.
        if string.sub(jobId, 1, 2) == "0:" then
            rcall("LREM", activeKey, 1, jobId)
            -- If jobId is special ID 0:delay (delay greater than 0), then there is no job to process
            -- but if ID is 0:0, then there is at least 1 prioritized job to process
            if jobId == "0:0" then
                jobId = moveJobFromPrioritizedToActive(prioritizedKey, activeKey, pcKey)
                return prepareJobForProcessing(prefix, rateLimiterKey,
                    eventStreamKey, jobId, timestamp, maxJobs,
                    limiterDuration, markerKey, opts)
            end
        else
            return prepareJobForProcessing(prefix, rateLimiterKey,
                eventStreamKey, jobId, timestamp, maxJobs,
                limiterDuration, markerKey, opts)
        end
    else
        jobId = moveJobFromPrioritizedToActive(prioritizedKey, activeKey, pcKey)
        if jobId then
            return prepareJobForProcessing(prefix, rateLimiterKey,
                eventStreamKey, jobId, timestamp, maxJobs,
                limiterDuration, markerKey, opts)
        end
    end
    -- Return the timestamp for the next delayed job if any.
    local nextTimestamp = getNextDelayedTimestamp(delayedKey)
    if nextTimestamp ~= nil then
        -- The result is guaranteed to be positive, since the
        -- ZRANGEBYSCORE command would have return a job otherwise.
        return {0, 0, 0, nextTimestamp}
    end
end
--[[
  Function to recursively move from waitingChildren to failed.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized)
  if no pending dependencies.
]]
-- Includes
--[[
  Validate and move parent to a wait status (waiting, delayed or prioritized) if needed.
]]
-- Includes
--[[
  Move parent to a wait status (wait, prioritized or delayed)
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    local parentWaitKey = parentQueueKey .. ":wait"
    local parentActiveKey = parentQueueKey .. ":active"
    local parentMetaKey = parentQueueKey .. ":meta"
    local parentMarkerKey = parentQueueKey .. ":marker"
    local jobAttributes = rcall("HMGET", parentKey, "priority", "delay")
    local priority = tonumber(jobAttributes[1]) or 0
    local delay = tonumber(jobAttributes[2]) or 0
    if delay > 0 then
        local delayedTimestamp = tonumber(timestamp) + delay
        local score = delayedTimestamp * 0x1000
        local parentDelayedKey = parentQueueKey .. ":delayed"
        rcall("ZADD", parentDelayedKey, score, parentId)
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "delayed", "jobId", parentId, "delay",
            delayedTimestamp)
        addDelayMarkerIfNeeded(parentMarkerKey, parentDelayedKey)
    else
        if priority == 0 then
            local isParentPausedOrMaxed =
                isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobInTargetList(parentWaitKey, parentMarkerKey, "RPUSH", isParentPausedOrMaxed, parentId)
        else
            local isPausedOrMaxed = isQueuePausedOrMaxed(parentMetaKey, parentActiveKey)
            addJobWithPriority(parentMarkerKey, parentQueueKey .. ":prioritized", priority, parentId,
                parentQueueKey .. ":pc", isPausedOrMaxed)
        end
        rcall("XADD", parentQueueKey .. ":events", "*", "event", "waiting", "jobId", parentId, "prev",
            "waiting-children")
    end
end
local function moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then    
      rcall("ZREM", parentWaitingChildrenKey, parentId)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    end
  end
end
local function moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey,
  parentId, timestamp)
  local doNotHavePendingDependencies = rcall("SCARD", parentDependenciesKey) == 0
  if doNotHavePendingDependencies then
    moveParentToWaitIfNeeded(parentQueueKey, parentKey, parentId, timestamp)
  end
end
local handleChildFailureAndMoveParentToWait = function (parentQueueKey, parentKey, parentId, jobIdKey, timestamp)
  if rcall("EXISTS", parentKey) == 1 then
    local parentWaitingChildrenKey = parentQueueKey .. ":waiting-children"
    local parentDelayedKey = parentQueueKey .. ":delayed"
    local parentWaitingChildrenOrDelayedKey
    if rcall("ZSCORE", parentWaitingChildrenKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentWaitingChildrenKey
    elseif rcall("ZSCORE", parentDelayedKey, parentId) then
      parentWaitingChildrenOrDelayedKey = parentDelayedKey
      rcall("HSET", parentKey, "delay", 0)
    end
    if parentWaitingChildrenOrDelayedKey then
      rcall("ZREM", parentWaitingChildrenOrDelayedKey, parentId)
      local deferredFailure = "child " .. jobIdKey .. " failed"
      rcall("HSET", parentKey, "defa", deferredFailure)
      moveParentToWait(parentQueueKey, parentKey, parentId, timestamp)
    else
      if not rcall("ZSCORE", parentQueueKey .. ":failed", parentId) then
        local deferredFailure = "child " .. jobIdKey .. " failed"
        rcall("HSET", parentKey, "defa", deferredFailure)
      end
    end
  end
end
local moveChildFromDependenciesIfNeeded = function (rawParentData, childKey, failedReason, timestamp)
  if rawParentData then
    local parentData = cjson.decode(rawParentData)
    local parentKey = parentData['queueKey'] .. ':' .. parentData['id']
    local parentDependenciesChildrenKey = parentKey .. ":dependencies"
    if parentData['fpof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        local parentUnsuccessfulChildrenKey = parentKey .. ":unsuccessful"
        rcall("ZADD", parentUnsuccessfulChildrenKey, timestamp, childKey)
        handleChildFailureAndMoveParentToWait(
          parentData['queueKey'],
          parentKey,
          parentData['id'],
          childKey,
          timestamp
        )
      end
    elseif parentData['cpof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        local parentFailedChildrenKey = parentKey .. ":failed"
        rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
        moveParentToWaitIfNeeded(parentData['queueKey'], parentKey, parentData['id'], timestamp)
      end
    elseif parentData['idof'] or parentData['rdof'] then
      if rcall("SREM", parentDependenciesChildrenKey, childKey) == 1 then
        moveParentToWaitIfNoPendingDependencies(parentData['queueKey'], parentDependenciesChildrenKey,
          parentKey, parentData['id'], timestamp)
        if parentData['idof'] then
          local parentFailedChildrenKey = parentKey .. ":failed"
          rcall("HSET", parentFailedChildrenKey, childKey, failedReason)
        end
      end
    end
  end
end
--[[
  Function to remove deduplication key if needed
  when a job is moved to completed or failed states.
]]
local function removeDeduplicationKeyIfNeededOnFinalization(prefixKey,
  deduplicationId, jobId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local pttl = rcall("PTTL", deduplicationKey)
    if pttl == 0 then
      return rcall("DEL", deduplicationKey)
    end
    if pttl == -1 then
      local currentJobId = rcall('GET', deduplicationKey)
      if currentJobId and currentJobId == jobId then
        return rcall("DEL", deduplicationKey)
      end
    end
  end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Functions to remove jobs by max age.
]]
-- Includes
--[[
  Function to remove job.
]]
-- Includes
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
local function removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix, maxLimit)
  local start = timestamp - maxAge * 1000
  local jobIds = rcall("ZREVRANGEBYSCORE", targetSet, start, "-inf", "LIMIT", 0, maxLimit)
  for i, jobId in ipairs(jobIds) do
    removeJob(jobId, false, prefix, false --[[remove debounce key]])
  end
  if #jobIds > 0 then
    if #jobIds < maxLimit then
      rcall("ZREMRANGEBYSCORE", targetSet, "-inf", start)
    else
      for from, to in batches(#jobIds, 7000) do
        rcall("ZREM", targetSet, unpack(jobIds, from, to))
      end
    end
  end
end
--[[
  Functions to remove jobs by max count.
]]
-- Includes
local function removeJobsByMaxCount(maxCount, targetSet, prefix)
  local start = maxCount
  local jobIds = rcall("ZREVRANGE", targetSet, start, -1)
  for i, jobId in ipairs(jobIds) do
    removeJob(jobId, false, prefix, false --[[remove debounce key]])
  end
  rcall("ZREMRANGEBYRANK", targetSet, 0, -(maxCount + 1))
end
local function removeLock(jobKey, stalledKey, token, jobId)
  if token ~= "0" then
    local lockKey = jobKey .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if lockToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", stalledKey, jobId)
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end
  return 0
end
--[[
  Function to create a new job from stored dedup-next data
  when a deduplicated job with keepLastIfActive finishes.
  At most one next job is created per deduplication ID.
  Multiple triggers while active overwrite the dedup-next data,
  so only the latest data is used.
]]
-- Includes
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to set the deduplication key for a job.
  Uses TTL from deduplication opts if provided.
]]
local function setDeduplicationKey(deduplicationKey, jobId, deduplicationOpts)
    local ttl = deduplicationOpts and deduplicationOpts['ttl']
    if ttl and ttl > 0 then
        rcall('SET', deduplicationKey, jobId, 'PX', ttl)
    else
        rcall('SET', deduplicationKey, jobId)
    end
end
--[[
  Shared helper to store a job and enqueue it into the appropriate list/set.
  Handles delayed, prioritized, and standard (LIFO/FIFO) jobs.
  Emits the appropriate event after enqueuing ("delayed" or "waiting").
  Returns delay, priority from storeJob.
]]
-- Includes
--[[
  Adds a delayed job to the queue by doing the following:
    - Creates a new job key with the job data.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
]]
-- Includes
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
local function addDelayedJob(jobId, delayedKey, eventsKey, timestamp,
  maxEvents, markerKey, delay)
  local score, delayedTimestamp = getDelayedScore(delayedKey, timestamp, tonumber(delay))
  rcall("ZADD", delayedKey, score, jobId)
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)
  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(markerKey, delayedKey)
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
local function storeAndEnqueueJob(eventsKey, jobIdKey, jobId, name, data, opts,
    timestamp, parentKey, parentData, repeatJobKey, maxEvents,
    waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
    priorityCounterKey, delayedKey, markerKey)
  local delay, priority = storeJob(eventsKey, jobIdKey, jobId, name, data,
      opts, timestamp, parentKey, parentData, repeatJobKey)
  if delay ~= 0 and delayedKey then
    addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, markerKey, delay)
  else
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
    if priority > 0 then
      addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
          priorityCounterKey, isPausedOrMaxed)
    else
      local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
      addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
    end
    rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", jobId)
  end
  return delay, priority
end
local function requeueDeduplicatedJob(prefix, deduplicationId, eventStreamKey,
    metaKey, activeKey, waitKey, pausedKey, markerKey, prioritizedKey,
    priorityCounterKey, delayedKey, timestamp)
  local deduplicationNextKey = prefix .. "dn:" .. deduplicationId
  if rcall("EXISTS", deduplicationNextKey) == 1 then
    local nextData = rcall("HMGET", deduplicationNextKey,
        "name", "data", "opts", "pk", "pd", "pdk", "rjk", "jid")
    -- Always increment the counter to keep it monotonic
    local nextId = rcall("INCR", prefix .. "id") .. ""
    local storedJobId = nextData[8] -- index 8 = "jid" (8th field in the HMGET call above)
    local newJobId
    if storedJobId then
      newJobId = storedJobId
    else
      newJobId = nextId
    end
    local newJobIdKey = prefix .. newJobId
    local newOpts = cjson.decode(nextData[3])
    local deduplicationKey = prefix .. "de:" .. deduplicationId
    local parentKey = nextData[4] or nil
    local parentData = nextData[5] or nil
    local parentDependenciesKey = nextData[6] or nil
    local repeatJobKey = nextData[7] or nil
    -- Set dedup key for the new job (without TTL when keepLastIfActive,
    -- so the key outlives the job's active duration)
    local deOpts = newOpts['de']
    if deOpts and deOpts['keepLastIfActive'] then
      rcall('SET', deduplicationKey, newJobId)
    else
      setDeduplicationKey(deduplicationKey, newJobId, deOpts)
    end
    -- Store and enqueue using the shared helper (handles priority/lifo/delayed)
    local maxEvents = getOrSetMaxEvents(metaKey)
    storeAndEnqueueJob(eventStreamKey, newJobIdKey, newJobId, nextData[1], nextData[2],
        newOpts, timestamp, parentKey, parentData, repeatJobKey, maxEvents,
        waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
        priorityCounterKey, delayedKey, markerKey)
    -- Register as child dependency if the job has a parent
    if parentDependenciesKey then
      rcall("SADD", parentDependenciesKey, newJobIdKey)
    end
    -- Only delete the dedup-next hash after the job is fully created,
    -- so that if any step above errors, the data is not permanently lost.
    rcall("DEL", deduplicationNextKey)
  end
end
--[[
  Function to trim events, default 10000.
]]
-- Includes
local function trimEvents(metaKey, eventStreamKey)
  local maxEvents = getOrSetMaxEvents(metaKey)
  if maxEvents then
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", maxEvents)
  else
    rcall("XTRIM", eventStreamKey, "MAXLEN", "~", 10000)
  end
end
--[[
  Validate and move or add dependencies to parent.
]]
-- Includes
local function updateParentDepsIfNeeded(parentKey, parentQueueKey, parentDependenciesKey,
  parentId, jobIdKey, returnvalue, timestamp )
  local processedSet = parentKey .. ":processed"
  rcall("HSET", processedSet, jobIdKey, returnvalue)
  moveParentToWaitIfNoPendingDependencies(parentQueueKey, parentDependenciesKey, parentKey, parentId, timestamp)
end
--[[
  Function to update a bunch of fields in a job.
]]
local function updateJobFields(jobKey, msgpackedFields)
  if msgpackedFields and #msgpackedFields > 0 then
    local fieldsToUpdate = cmsgpack.unpack(msgpackedFields)
    if fieldsToUpdate then
      rcall("HMSET", jobKey, unpack(fieldsToUpdate))
    end
  end
end
local jobIdKey = KEYS[12]
if rcall("EXISTS", jobIdKey) == 1 then -- Make sure job exists
    -- Make sure it does not have pending dependencies
    -- It must happen before removing lock
    if ARGV[5] == "completed" then
        if rcall("SCARD", jobIdKey .. ":dependencies") ~= 0 then
            return -4
        end
        if rcall("ZCARD", jobIdKey .. ":unsuccessful") ~= 0 then
            return -9
        end
    end
    local opts = cmsgpack.unpack(ARGV[8])
    local token = opts['token']
    local errorCode = removeLock(jobIdKey, KEYS[5], token, ARGV[1])
    if errorCode < 0 then
        return errorCode
    end
    updateJobFields(jobIdKey, ARGV[9]);
    local attempts = opts['attempts']
    local maxMetricsSize = opts['maxMetricsSize']
    local maxCount = opts['keepJobs']['count']
    local maxAge = opts['keepJobs']['age']
    local maxLimit = opts['keepJobs']['limit'] or 1000
    local jobAttributes = rcall("HMGET", jobIdKey, "parentKey", "parent", "deid")
    local parentKey = jobAttributes[1] or ""
    local parentId = ""
    local parentQueueKey = ""
    if jobAttributes[2] then -- TODO: need to revisit this logic if it's still needed
        local jsonDecodedParent = cjson.decode(jobAttributes[2])
        parentId = jsonDecodedParent['id']
        parentQueueKey = jsonDecodedParent['queueKey']
    end
    local jobId = ARGV[1]
    local timestamp = ARGV[2]
    -- Remove from active list (if not active we shall return error)
    local numRemovedElements = rcall("LREM", KEYS[2], -1, jobId)
    if (numRemovedElements < 1) then
        return -3
    end
    local eventStreamKey = KEYS[4]
    local metaKey = KEYS[9]
    -- Trim events before emitting them to avoid trimming events emitted in this script
    trimEvents(metaKey, eventStreamKey)
    local prefix = ARGV[7]
    removeDeduplicationKeyIfNeededOnFinalization(prefix, jobAttributes[3], jobId)
    -- Check if there is requeue data for this dedup ID (keepLastIfActive mode)
    if jobAttributes[3] then
      requeueDeduplicatedJob(prefix, jobAttributes[3], eventStreamKey,
          metaKey, KEYS[2], KEYS[1], KEYS[8], KEYS[14], KEYS[3], KEYS[10],
          KEYS[7], timestamp)
    end
    -- If job has a parent we need to
    -- 1) remove this job id from parents dependencies
    -- 2) move the job Id to parent "processed" set
    -- 3) push the results into parent "results" list
    -- 4) if parent's dependencies is empty, then move parent to "wait/paused". Note it may be a different queue!.
    if parentId == "" and parentKey ~= "" then
        parentId = getJobIdFromKey(parentKey)
        parentQueueKey = getJobKeyPrefix(parentKey, ":" .. parentId)
    end
    if parentId ~= "" then
        if ARGV[5] == "completed" then
            local dependenciesSet = parentKey .. ":dependencies"
            if rcall("SREM", dependenciesSet, jobIdKey) == 1 then
                updateParentDepsIfNeeded(parentKey, parentQueueKey, dependenciesSet, parentId, jobIdKey, ARGV[4],
                    timestamp)
            end
        else
            moveChildFromDependenciesIfNeeded(jobAttributes[2], jobIdKey, ARGV[4], timestamp)
        end
    end
    local attemptsMade = rcall("HINCRBY", jobIdKey, "atm", 1)
    -- Remove job?
    if maxCount ~= 0 then
        local targetSet = KEYS[11]
        -- Add to complete/failed set
        rcall("ZADD", targetSet, timestamp, jobId)
        rcall("HSET", jobIdKey, ARGV[3], ARGV[4], "finishedOn", timestamp)
        -- "returnvalue" / "failedReason" and "finishedOn"
        if ARGV[5] == "failed" then
            rcall("HDEL", jobIdKey, "defa")
        end
        -- Remove old jobs?
        if maxAge ~= nil then
            removeJobsByMaxAge(timestamp, maxAge, targetSet, prefix, maxLimit)
        end
        if maxCount ~= nil and maxCount > 0 then
            removeJobsByMaxCount(maxCount, targetSet, prefix)
        end
    else
        removeJobKeys(jobIdKey)
        if parentKey ~= "" then
            -- TODO: when a child is removed when finished, result or failure in parent
            -- must not be deleted, those value references should be deleted when the parent
            -- is deleted
            removeParentDependencyKey(jobIdKey, false, parentKey, jobAttributes[3])
        end
    end
    rcall("XADD", eventStreamKey, "*", "event", ARGV[5], "jobId", jobId, ARGV[3], ARGV[4], "prev", "active")
    if ARGV[5] == "failed" then
        if tonumber(attemptsMade) >= tonumber(attempts) then
            rcall("XADD", eventStreamKey, "*", "event", "retries-exhausted", "jobId", jobId, "attemptsMade",
                attemptsMade)
        end
    end
    -- Collect metrics
    if maxMetricsSize ~= "" then
        collectMetrics(KEYS[13], KEYS[13] .. ':data', maxMetricsSize, timestamp)
    end
    -- Try to get next job to avoid an extra roundtrip if the queue is not closing,
    -- and not rate limited.
    if (ARGV[6] == "1") then
        local result = fetchNextJob(KEYS[1], KEYS[2], KEYS[3], eventStreamKey,
            KEYS[6], KEYS[7], metaKey, KEYS[10], KEYS[14], prefix,
            timestamp, opts)
        if result then
            return result
        end
    end
    local waitLen = rcall("LLEN", KEYS[1])
    if waitLen == 0 then
        local activeLen = rcall("LLEN", KEYS[2])
        if activeLen == 0 then
            local prioritizedLen = rcall("ZCARD", KEYS[3])
            if prioritizedLen == 0 then
                rcall("XADD", eventStreamKey, "*", "event", "drained")
            end
        end
    end
    return 0
else
    return -1
end
`,keys:14};e.s(["moveToFinished",0,ry],28646),e.i(28646);let rf={name:"moveToWaitingChildren",content:`--[[
  Moves job from active to waiting children set.
  Input:
    KEYS[1] active key
    KEYS[2] wait-children key
    KEYS[3] job key
    KEYS[4] job dependencies key
    KEYS[5] job unsuccessful key
    KEYS[6] stalled key
    KEYS[7] events key
    ARGV[1] token
    ARGV[2] child key
    ARGV[3] timestamp
    ARGV[4] jobId
    ARGV[5] prefix
  Output:
    0 - OK
    1 - There are not pending dependencies.
   -1 - Missing job.
   -2 - Missing lock
   -3 - Job not in active set
   -9 - Job has failed children
]]
local rcall = redis.call
local activeKey = KEYS[1]
local waitingChildrenKey = KEYS[2]
local jobKey = KEYS[3]
local jobDependenciesKey = KEYS[4]
local jobUnsuccessfulKey = KEYS[5]
local stalledKey = KEYS[6]
local eventStreamKey = KEYS[7]
local token = ARGV[1]
local timestamp = ARGV[3]
local jobId = ARGV[4]
--- Includes
local function removeLock(jobKey, stalledKey, token, jobId)
  if token ~= "0" then
    local lockKey = jobKey .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if lockToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", stalledKey, jobId)
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end
  return 0
end
local function removeJobFromActive(activeKey, stalledKey, jobKey, jobId,
    token)
  local errorCode = removeLock(jobKey, stalledKey, token, jobId)
  if errorCode < 0 then
    return errorCode
  end
  local numRemovedElements = rcall("LREM", activeKey, -1, jobId)
  if numRemovedElements < 1 then
    return -3
  end
  return 0
end
local function moveToWaitingChildren(activeKey, waitingChildrenKey, stalledKey, eventStreamKey,
    jobKey, jobId, timestamp, token)
  local errorCode = removeJobFromActive(activeKey, stalledKey, jobKey, jobId, token)
  if errorCode < 0 then
    return errorCode
  end
  local score = tonumber(timestamp)
  rcall("ZADD", waitingChildrenKey, score, jobId)
  rcall("XADD", eventStreamKey, "*", "event", "waiting-children", "jobId", jobId, 'prev', 'active')
  return 0
end
if rcall("EXISTS", jobKey) == 1 then
  if rcall("ZCARD", jobUnsuccessfulKey) ~= 0 then
    return -9
  else
    if ARGV[2] ~= "" then
      if rcall("SISMEMBER", jobDependenciesKey, ARGV[2]) ~= 0 then
        return moveToWaitingChildren(activeKey, waitingChildrenKey, stalledKey, eventStreamKey,
          jobKey, jobId, timestamp, token)
      end
      return 1
    else
      if rcall("SCARD", jobDependenciesKey) ~= 0 then 
        return moveToWaitingChildren(activeKey, waitingChildrenKey, stalledKey, eventStreamKey,
          jobKey, jobId, timestamp, token)
      end
      return 1
    end    
  end
end
return -1
`,keys:7};e.s(["moveToWaitingChildren",0,rf],82792),e.i(82792);let rb={name:"obliterate",content:`--[[
  Completely obliterates a queue and all of its contents
  This command completely destroys a queue including all of its jobs, current or past 
  leaving no trace of its existence. Since this script needs to iterate to find all the job
  keys, consider that this call may be slow for very large queues.
  The queue needs to be "paused" or it will return an error
  If the queue has currently active jobs then the script by default will return error,
  however this behaviour can be overridden using the 'force' option.
  Input:
    KEYS[1] meta
    KEYS[2] base
    ARGV[1] count
    ARGV[2] force
]]
local maxCount = tonumber(ARGV[1])
local baseKey = KEYS[2]
local rcall = redis.call
-- Includes
--[[
  Functions to remove jobs.
]]
-- Includes
--[[
  Function to remove job.
]]
-- Includes
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local function removeJob(jobId, hard, baseKey, shouldRemoveDeduplicationKey)
  local jobKey = baseKey .. jobId
  removeParentDependencyKey(jobKey, hard, nil, baseKey)
  if shouldRemoveDeduplicationKey then
    local deduplicationId = rcall("HGET", jobKey, "deid")
    removeDeduplicationKeyIfNeededOnRemoval(baseKey, jobId, deduplicationId)
  end
  removeJobKeys(jobKey)
end
local function removeJobs(keys, hard, baseKey, max)
  for i, key in ipairs(keys) do
    removeJob(key, hard, baseKey, true --[[remove debounce key]])
  end
  return max - #keys
end
--[[
  Functions to remove jobs.
]]
-- Includes
--[[
  Function to filter out jobs to ignore from a table.
]]
local function filterOutJobsToIgnore(jobs, jobsToIgnore)
  local filteredJobs = {}
  for i = 1, #jobs do
    if not jobsToIgnore[jobs[i]] then
      table.insert(filteredJobs, jobs[i])
    end
  end
  return filteredJobs
end
local function getListItems(keyName, max)
  return rcall('LRANGE', keyName, 0, max - 1)
end
local function removeListJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getListItems(keyName, max)
  if jobsToIgnore then
    jobs = filterOutJobsToIgnore(jobs, jobsToIgnore)
  end
  local count = removeJobs(jobs, hard, baseKey, max)
  rcall("LTRIM", keyName, #jobs, -1)
  return count
end
-- Includes
--[[
  Function to loop in batches.
  Just a bit of warning, some commands as ZREM
  could receive a maximum of 7000 parameters per call.
]]
local function batches(n, batchSize)
  local i = 0
  return function()
    local from = i * batchSize + 1
    i = i + 1
    if (from <= n) then
      local to = math.min(from + batchSize - 1, n)
      return from, to
    end
  end
end
--[[
  Function to get ZSet items.
]]
local function getZSetItems(keyName, max)
  return rcall('ZRANGE', keyName, 0, max - 1)
end
local function removeZSetJobs(keyName, hard, baseKey, max, jobsToIgnore)
  local jobs = getZSetItems(keyName, max)
  if jobsToIgnore then
    jobs = filterOutJobsToIgnore(jobs, jobsToIgnore)
  end
  local count = removeJobs(jobs, hard, baseKey, max)
  if(#jobs > 0) then
    for from, to in batches(#jobs, 7000) do
      rcall("ZREM", keyName, unpack(jobs, from, to))
    end
  end
  return count
end
local function removeLockKeys(keys)
  for i, key in ipairs(keys) do
    rcall("DEL", baseKey .. key .. ':lock')
  end
end
-- 1) Check if paused, if not return with error.
if rcall("HEXISTS", KEYS[1], "paused") ~= 1 then
  return -1 -- Error, NotPaused
end
-- 2) Check if there are active jobs, if there are and not "force" return error.
local activeKey = baseKey .. 'active'
local activeJobs = getListItems(activeKey, maxCount)
if (#activeJobs > 0) then
  if(ARGV[2] == "") then 
    return -2 -- Error, ExistActiveJobs
  end
end
removeLockKeys(activeJobs)
maxCount = removeJobs(activeJobs, true, baseKey, maxCount)
rcall("LTRIM", activeKey, #activeJobs, -1)
if(maxCount <= 0) then
  return 1
end
local delayedKey = baseKey .. 'delayed'
maxCount = removeZSetJobs(delayedKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
local repeatKey = baseKey .. 'repeat'
local repeatJobsIds = getZSetItems(repeatKey, maxCount)
for i, key in ipairs(repeatJobsIds) do
  local jobKey = repeatKey .. ":" .. key
  rcall("DEL", jobKey)
end
if(#repeatJobsIds > 0) then
  for from, to in batches(#repeatJobsIds, 7000) do
    rcall("ZREM", repeatKey, unpack(repeatJobsIds, from, to))
  end
end
maxCount = maxCount - #repeatJobsIds
if(maxCount <= 0) then
  return 1
end
local completedKey = baseKey .. 'completed'
maxCount = removeZSetJobs(completedKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
local waitKey = baseKey .. 'wait'
maxCount = removeListJobs(waitKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
-- Backwards compatibility: older versions used a separate "paused" list.
local pausedKey = baseKey .. 'paused'
maxCount = removeListJobs(pausedKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
local prioritizedKey = baseKey .. 'prioritized'
maxCount = removeZSetJobs(prioritizedKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
local failedKey = baseKey .. 'failed'
maxCount = removeZSetJobs(failedKey, true, baseKey, maxCount)
if(maxCount <= 0) then
  return 1
end
if(maxCount > 0) then
  rcall("DEL",
    baseKey .. 'events',
    baseKey .. 'delay',
    baseKey .. 'stalled-check',
    baseKey .. 'stalled',
    baseKey .. 'id',
    baseKey .. 'pc',
    baseKey .. 'marker',
    baseKey .. 'meta',
    baseKey .. 'metrics:completed',
    baseKey .. 'metrics:completed:data',
    baseKey .. 'metrics:failed',
    baseKey .. 'metrics:failed:data')
  return 0
else
  return 1
end
`,keys:2};e.s(["obliterate",0,rb],35933),e.i(35933);let rg={name:"paginate",content:`--[[
    Paginate a set or hash
    Input:
      KEYS[1] key pointing to the set or hash to be paginated.
      ARGV[1]  page start offset
      ARGV[2]  page end offset (-1 for all the elements)
      ARGV[3]  cursor
      ARGV[4]  offset
      ARGV[5]  max iterations
      ARGV[6]  fetch jobs?
    Output:
      [cursor, offset, items, numItems]
]]
local rcall = redis.call
-- Includes
--[[
  Function to achieve pagination for a set or hash.
  This function simulates pagination in the most efficient way possible
  for a set using sscan or hscan.
  The main limitation is that sets are not order preserving, so the
  pagination is not stable. This means that if the set is modified
  between pages, the same element may appear in different pages.
]] -- Maximum number of elements to be returned by sscan per iteration.
local maxCount = 100
-- Finds the cursor, and returns the first elements available for the requested page.
local function findPage(key, command, pageStart, pageSize, cursor, offset,
                        maxIterations, fetchJobs)
    local items = {}
    local jobs = {}
    local iterations = 0
    repeat
        -- Iterate over the set using sscan/hscan.
        local result = rcall(command, key, cursor, "COUNT", maxCount)
        cursor = result[1]
        local members = result[2]
        local step = 1
        if command == "HSCAN" then
            step = 2
        end
        if #members == 0 then
            -- If the result is empty, we can return the result.
            return cursor, offset, items, jobs
        end
        local chunkStart = offset
        local chunkEnd = offset + #members / step
        local pageEnd = pageStart + pageSize
        if chunkEnd < pageStart then
            -- If the chunk is before the page, we can skip it.
            offset = chunkEnd
        elseif chunkStart > pageEnd then
            -- If the chunk is after the page, we can return the result.
            return cursor, offset, items, jobs
        else
            -- If the chunk is overlapping the page, we need to add the elements to the result.
            for i = 1, #members, step do
                if offset >= pageEnd then
                    return cursor, offset, items, jobs
                end
                if offset >= pageStart then
                    local index = #items + 1
                    if fetchJobs ~= nil then
                        jobs[#jobs+1] = rcall("HGETALL", members[i])
                    end
                    if step == 2 then
                        items[index] = {members[i], members[i + 1]}
                    else
                        items[index] = members[i]
                    end
                end
                offset = offset + 1
            end
        end
        iterations = iterations + 1
    until cursor == "0" or iterations >= maxIterations
    return cursor, offset, items, jobs
end
local key = KEYS[1]
local scanCommand = "SSCAN"
local countCommand = "SCARD"
local type = rcall("TYPE", key)["ok"]
if type == "none" then
    return {0, 0, {}, 0}
elseif type == "hash" then
    scanCommand = "HSCAN"
    countCommand = "HLEN"
elseif type ~= "set" then
    return
        redis.error_reply("Pagination is only supported for sets and hashes.")
end
local numItems = rcall(countCommand, key)
local startOffset = tonumber(ARGV[1])
local endOffset = tonumber(ARGV[2])
if endOffset == -1 then 
  endOffset = numItems
end
local pageSize = (endOffset - startOffset) + 1
local cursor, offset, items, jobs = findPage(key, scanCommand, startOffset,
                                       pageSize, ARGV[3], tonumber(ARGV[4]),
                                       tonumber(ARGV[5]), ARGV[6])
return {cursor, offset, items, numItems, jobs}
`,keys:1};e.s(["paginate",0,rg],50518),e.i(50518);let rK={name:"pause",content:`--[[
  Pauses or resumes a queue globally.
  Input:
    KEYS[1] 'wait' or 'paused'
    KEYS[2] 'paused' or 'wait'
    KEYS[3] 'meta'
    KEYS[4] 'prioritized'
    KEYS[5] events stream key
    KEYS[6] 'delayed'
    KEYS[7] 'marker'
    ARGV[1] 'paused' or 'resumed'
    ARGV[2] '1' to emit event, '0' to skip it
  Event:
    publish paused or resumed event.
]]
local rcall = redis.call
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Get count jobs in wait or prioritized.
]]
local function getWaitPlusPrioritizedCount(waitKey, prioritizedKey)
  local waitCount = rcall("LLEN", waitKey)
  local prioritizedCount = rcall("ZCARD", prioritizedKey)
  return waitCount + prioritizedCount
end
local markerKey = KEYS[7]
local emitEvent = ARGV[2] ~= "0"
local legacyPausedRemaining = 0
if ARGV[1] == "paused" then
    rcall("HSET", KEYS[3], "paused", 1)
    rcall("DEL", markerKey)
else
    rcall("HDEL", KEYS[3], "paused")
    --jobs in paused key
    local hasJobs = rcall("EXISTS", KEYS[1]) == 1
    if hasJobs then
        if rcall("EXISTS", KEYS[2]) == 0 then
            rcall("RENAME", KEYS[1], KEYS[2])
        else
            --move a maximum of 7000 jobs per resume call in order to not block
            --using LRANGE 0..6999 so each RPUSH argument list stays bounded
            --if users have more jobs in paused state, call resume multiple times
            local jobs = rcall('LRANGE', KEYS[1], 0, 6999)
            rcall("RPUSH", KEYS[2], unpack(jobs))
            rcall("LTRIM", KEYS[1], #jobs, -1)
            legacyPausedRemaining = rcall("LLEN", KEYS[1])
        end
    end
    if getWaitPlusPrioritizedCount(KEYS[2], KEYS[4]) > 0 then
        -- Add marker if there are waiting or priority jobs
        rcall("ZADD", markerKey, 0, "0")
    else
        addDelayMarkerIfNeeded(markerKey, KEYS[6])
    end
end
if emitEvent then
    rcall("XADD", KEYS[5], "*", "event", ARGV[1]);
end
return legacyPausedRemaining
`,keys:7};e.s(["pause",0,rK],77380),e.i(77380);let rv={name:"promote",content:`--[[
  Promotes a job that is currently "delayed" to the "waiting" state
    Input:
      KEYS[1] 'delayed'
      KEYS[2] 'wait'
      KEYS[3] 'paused'
      KEYS[4] 'meta'
      KEYS[5] 'prioritized'
      KEYS[6] 'active'
      KEYS[7] 'pc' priority counter
      KEYS[8] 'event stream'
      KEYS[9] 'marker'
      ARGV[1]  queue.toKey('')
      ARGV[2]  jobId
    Output:
       0 - OK
      -3 - Job not in delayed zset.
    Events:
      'waiting'
]]
local rcall = redis.call
local jobId = ARGV[2]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
if rcall("ZREM", KEYS[1], jobId) == 1 then
    local jobKey = ARGV[1] .. jobId
    local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
    local metaKey = KEYS[4]
    local markerKey = KEYS[9]
    -- Remove delayed "marker" from the wait list if there is any.
    -- Since we are adding a job we do not need the marker anymore.
    -- Markers in waitlist DEPRECATED in v5: Remove in v6.
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, KEYS[6])
    local marker = rcall("LINDEX", KEYS[2], 0)
    if marker and string.sub(marker, 1, 2) == "0:" then rcall("LPOP", KEYS[2]) end
    if priority == 0 then
        -- LIFO or FIFO
        addJobInTargetList(KEYS[2], markerKey, "LPUSH", isPausedOrMaxed, jobId)
    else
        addJobWithPriority(markerKey, KEYS[5], priority, jobId, KEYS[7], isPausedOrMaxed)
    end
    rcall("XADD", KEYS[8], "*", "event", "waiting", "jobId", jobId, "prev",
          "delayed");
    rcall("HSET", jobKey, "delay", 0)
    return 0
else
    return -3
end
`,keys:9};e.s(["promote",0,rv],30498),e.i(30498);let rE={name:"releaseLock",content:`--[[
  Release lock
    Input:
      KEYS[1] 'lock',
      ARGV[1]  token
      ARGV[2]  lock duration in milliseconds
    Output:
      "OK" if lock extended successfully.
]]
local rcall = redis.call
if rcall("GET", KEYS[1]) == ARGV[1] then
  return rcall("DEL", KEYS[1])
else
  return 0
end
`,keys:1};e.s(["releaseLock",0,rE],47776),e.i(47776);let rI={name:"removeChildDependency",content:`--[[
  Break parent-child dependency by removing
  child reference from parent
  Input:
    KEYS[1] 'key' prefix,
    ARGV[1] job key
    ARGV[2] parent key
    Output:
       0  - OK
       1  - There is not relationship.
      -1  - Missing job key
      -5  - Missing parent key
]]
local rcall = redis.call
local jobKey = ARGV[1]
local parentKey = ARGV[2]
-- Includes
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
if rcall("EXISTS", jobKey) ~= 1 then return -1 end
if rcall("EXISTS", parentKey) ~= 1 then return -5 end
if removeParentDependencyKey(jobKey, false, parentKey, KEYS[1], nil) then
  rcall("HDEL", jobKey, "parentKey", "parent")
  return 0
else
  return 1
end`,keys:1};e.s(["removeChildDependency",0,rI],90342),e.i(90342);let rw={name:"removeDeduplicationKey",content:`--[[
  Remove deduplication key if it matches the job id.
  Input:
    KEYS[1] deduplication key
    ARGV[1] job id
  Output:
    0 - false
    1 - true
]]
local rcall = redis.call
local deduplicationKey = KEYS[1]
local jobId = ARGV[1]
local currentJobId = rcall('GET', deduplicationKey)
if currentJobId and currentJobId == jobId then
  return rcall("DEL", deduplicationKey)
end
return 0
`,keys:1};e.s(["removeDeduplicationKey",0,rw],91933),e.i(91933);let rS={name:"removeJob",content:`--[[
    Remove a job from all the statuses it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.
    Input:
      KEYS[1] jobKey
      KEYS[2] repeat key
      ARGV[1] jobId
      ARGV[2] remove children
      ARGV[3] queue prefix
    Events:
      'removed'
]]
local rcall = redis.call
-- Includes
--[[
  Function to check if the job belongs to a job scheduler and
  current delayed job matches with jobId
]]
local function isJobSchedulerJob(jobId, jobKey, jobSchedulersKey)
  local repeatJobKey = rcall("HGET", jobKey, "rjk")
  if repeatJobKey  then
    local prevMillis = rcall("ZSCORE", jobSchedulersKey, repeatJobKey)
    if prevMillis then
      local currentDelayedJobId = "repeat:" .. repeatJobKey .. ":" .. prevMillis
      return jobId == currentDelayedJobId
    end
  end
  return false
end
--[[
  Function to recursively check if there are no locks
  on the jobs to be removed.
  returns:
    boolean
]]
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
local function isLocked( prefix, jobId, removeChildren)
  local jobKey = prefix .. jobId;
  -- Check if this job is locked
  local lockKey = jobKey .. ':lock'
  local lock = rcall("GET", lockKey)
  if not lock then
    if removeChildren == "1" then
      local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
      if (#dependencies > 0) then
        for i, childJobKey in ipairs(dependencies) do
          -- We need to get the jobId for this job.
          local childJobId = getJobIdFromKey(childJobKey)
          local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
          local result = isLocked( childJobPrefix, childJobId, removeChildren )
          if result then
            return true
          end
        end
      end
    end
    return false
  end
  return true
end
--[[
    Remove a job from all the statuses it may be in as well as all its data,
    including its children. Active children can be ignored.
    Events:
      'removed'
]]
local rcall = redis.call
-- Includes
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove from any state.
  returns:
    prev state
]]
local function removeJobFromAnyState( prefix, jobId)
  -- We start with the ZSCORE checks, since they have O(1) complexity
  if rcall("ZSCORE", prefix .. "completed", jobId) then
    rcall("ZREM", prefix .. "completed", jobId)
    return "completed"
  elseif rcall("ZSCORE", prefix .. "waiting-children", jobId) then
    rcall("ZREM", prefix .. "waiting-children", jobId)
    return "waiting-children"
  elseif rcall("ZSCORE", prefix .. "delayed", jobId) then
    rcall("ZREM", prefix .. "delayed", jobId)
    return "delayed"
  elseif rcall("ZSCORE", prefix .. "failed", jobId) then
    rcall("ZREM", prefix .. "failed", jobId)
    return "failed"
  elseif rcall("ZSCORE", prefix .. "prioritized", jobId) then
    rcall("ZREM", prefix .. "prioritized", jobId)
    return "prioritized"
  -- We remove only 1 element from the list, since we assume they are not added multiple times
  elseif rcall("LREM", prefix .. "wait", 1, jobId) == 1 then
    return "wait"
  elseif rcall("LREM", prefix .. "paused", 1, jobId) == 1 then
    return "paused"
  elseif rcall("LREM", prefix .. "active", 1, jobId) == 1 then
    return "active"
  end
  return "unknown"
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
local removeJobChildren
local removeJobWithChildren
removeJobChildren = function(prefix, jobKey, options)
    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in a depth-first way
    -- because if some job is locked, we must exit with an error.
    if not options.ignoreProcessed then
        local processed = rcall("HGETALL", jobKey .. ":processed")
        if #processed > 0 then
            for i = 1, #processed, 2 do
                local childJobId = getJobIdFromKey(processed[i])
                local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
        local failed = rcall("HGETALL", jobKey .. ":failed")
        if #failed > 0 then
            for i = 1, #failed, 2 do
                local childJobId = getJobIdFromKey(failed[i])
                local childJobPrefix = getJobKeyPrefix(failed[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
        local unsuccessful = rcall("ZRANGE", jobKey .. ":unsuccessful", 0, -1)
        if #unsuccessful > 0 then
            for i = 1, #unsuccessful, 1 do
                local childJobId = getJobIdFromKey(unsuccessful[i])
                local childJobPrefix = getJobKeyPrefix(unsuccessful[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
    end
    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if #dependencies > 0 then
        for i, childJobKey in ipairs(dependencies) do
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
        end
    end
end
removeJobWithChildren = function(prefix, jobId, parentKey, options)
    local jobKey = prefix .. jobId
    if options.ignoreLocked then
        if isLocked(prefix, jobId) then
            return
        end
    end
    -- Check if job is in the failed zset
    local failedSet = prefix .. "failed"
    if not (options.ignoreProcessed and rcall("ZSCORE", failedSet, jobId)) then
        removeParentDependencyKey(jobKey, false, parentKey, nil)
        if options.removeChildren then
            removeJobChildren(prefix, jobKey, options)
        end
        local prev = removeJobFromAnyState(prefix, jobId)
        local deduplicationId = rcall("HGET", jobKey, "deid")
        removeDeduplicationKeyIfNeededOnRemoval(prefix, jobId, deduplicationId)
        if removeJobKeys(jobKey) > 0 then
            local metaKey = prefix .. "meta"
            local maxEvents = getOrSetMaxEvents(metaKey)
            rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*", "event", "removed",
                "jobId", jobId, "prev", prev)
        end
    end
end
local jobId = ARGV[1]
local shouldRemoveChildren = ARGV[2]
local prefix = ARGV[3]
local jobKey = KEYS[1]
local repeatKey = KEYS[2]
if isJobSchedulerJob(jobId, jobKey, repeatKey) then
    return -8
end
if not isLocked(prefix, jobId, shouldRemoveChildren) then
    local options = {
        removeChildren = shouldRemoveChildren == "1",
        ignoreProcessed = false,
        ignoreLocked = false
    }
    removeJobWithChildren(prefix, jobId, nil, options)
    return 1
end
return 0
`,keys:2};e.s(["removeJob",0,rS],25665),e.i(25665);let rk={name:"removeJobScheduler",content:`--[[
  Removes a job scheduler and its next scheduled job.
  Input:
    KEYS[1] job schedulers key
    KEYS[2] delayed jobs key
    KEYS[3] events key
    ARGV[1] job scheduler id
    ARGV[2] prefix key
  Output:
    0 - OK
    1 - Missing repeat job
  Events:
    'removed'
]]
local rcall = redis.call
-- Includes
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
local jobSchedulerId = ARGV[1]
local prefix = ARGV[2]
local millis = rcall("ZSCORE", KEYS[1], jobSchedulerId)
if millis then
  -- Delete next programmed job.
  local delayedJobId = "repeat:" .. jobSchedulerId .. ":" .. millis
  if(rcall("ZREM", KEYS[2], delayedJobId) == 1) then
    removeJobKeys(prefix .. delayedJobId)
    rcall("XADD", KEYS[3], "*", "event", "removed", "jobId", delayedJobId, "prev", "delayed")
  end
end
if(rcall("ZREM", KEYS[1], jobSchedulerId) == 1) then
  rcall("DEL", KEYS[1] .. ":" .. jobSchedulerId)
  return 0
end
return 1
`,keys:3};e.s(["removeJobScheduler",0,rk],73024),e.i(73024);let rj={name:"removeOrphanedJobs",content:`--[[
  Removes orphaned job keys that exist in Redis but are not referenced
  in any queue state set. Checks each candidate atomically.
  Input:
    KEYS[1]  base prefix key including trailing colon (e.g. bull:queueName:)
    ARGV[1]  number of state key suffixes
    ARGV[2 .. 1+N]  state key suffixes (e.g. active, wait, completed, ...)
    ARGV[2+N]  number of job sub-key suffixes
    ARGV[3+N .. 2+N+M]  job sub-key suffixes (e.g. logs, dependencies, ...)
    ARGV[3+N+M .. end]  candidate job IDs to check
  Output:
    number of removed jobs
]]
local rcall = redis.call
local basePrefix = KEYS[1]
-- Parse state key suffixes and cache their full key names + types.
local stateKeyCount = tonumber(ARGV[1])
local stateKeys = {}
local stateKeyTypes = {}
for i = 1, stateKeyCount do
  local fullKey = basePrefix .. ARGV[1 + i]
  stateKeys[i] = fullKey
  stateKeyTypes[i] = rcall('TYPE', fullKey)['ok']
end
-- Parse job sub-key suffixes.
local subKeyCountIdx = 2 + stateKeyCount
local subKeyCount = tonumber(ARGV[subKeyCountIdx])
local subKeySuffixes = {}
for i = 1, subKeyCount do
  subKeySuffixes[i] = ARGV[subKeyCountIdx + i]
end
-- Process candidate job IDs.
local candidateStart = subKeyCountIdx + subKeyCount + 1
local removedCount = 0
for c = candidateStart, #ARGV do
  local jobId = ARGV[c]
  local found = false
  for i = 1, stateKeyCount do
    local kt = stateKeyTypes[i]
    if kt == 'list' then
      if rcall('LPOS', stateKeys[i], jobId) then
        found = true
        break
      end
    elseif kt == 'zset' then
      if rcall('ZSCORE', stateKeys[i], jobId) then
        found = true
        break
      end
    elseif kt == 'set' then
      if rcall('SISMEMBER', stateKeys[i], jobId) == 1 then
        found = true
        break
      end
    end
  end
  if not found then
    local jobKey = basePrefix .. jobId
    local keysToDelete = { jobKey }
    for _, suffix in ipairs(subKeySuffixes) do
      keysToDelete[#keysToDelete + 1] = jobKey .. ':' .. suffix
    end
    rcall('DEL', unpack(keysToDelete))
    removedCount = removedCount + 1
  end
end
return removedCount
`,keys:1};e.s(["removeOrphanedJobs",0,rj],33962),e.i(33962);let rx={name:"removeUnprocessedChildren",content:`--[[
    Remove a job from all the statuses it may be in as well as all its data.
    In order to be able to remove a job, it cannot be active.
    Input:
      KEYS[1] jobKey
      KEYS[2] meta key
      ARGV[1] prefix
      ARGV[2] jobId
    Events:
      'removed' for every children removed
]]
-- Includes
--[[
    Remove a job from all the statuses it may be in as well as all its data,
    including its children. Active children can be ignored.
    Events:
      'removed'
]]
local rcall = redis.call
-- Includes
--[[
  Functions to destructure job key.
  Just a bit of warning, these functions may be a bit slow and affect performance significantly.
]]
local getJobIdFromKey = function (jobKey)
  return string.match(jobKey, ".*:(.*)")
end
local getJobKeyPrefix = function (jobKey, jobId)
  return string.sub(jobKey, 0, #jobKey - #jobId)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check if the job belongs to a job scheduler and
  current delayed job matches with jobId
]]
local function isJobSchedulerJob(jobId, jobKey, jobSchedulersKey)
  local repeatJobKey = rcall("HGET", jobKey, "rjk")
  if repeatJobKey  then
    local prevMillis = rcall("ZSCORE", jobSchedulersKey, repeatJobKey)
    if prevMillis then
      local currentDelayedJobId = "repeat:" .. repeatJobKey .. ":" .. prevMillis
      return jobId == currentDelayedJobId
    end
  end
  return false
end
--[[
  Function to remove deduplication key if needed
  when a job is being removed.
]]
local function removeDeduplicationKeyIfNeededOnRemoval(prefixKey,
  jobId, deduplicationId)
  if deduplicationId then
    local deduplicationKey = prefixKey .. "de:" .. deduplicationId
    local currentJobId = rcall('GET', deduplicationKey)
    if currentJobId and currentJobId == jobId then
      rcall("DEL", deduplicationKey)
      -- Also clean up any pending dedup-next data for this dedup ID
      rcall("DEL", prefixKey .. "dn:" .. deduplicationId)
      return 1
    end
  end
end
--[[
  Function to remove from any state.
  returns:
    prev state
]]
local function removeJobFromAnyState( prefix, jobId)
  -- We start with the ZSCORE checks, since they have O(1) complexity
  if rcall("ZSCORE", prefix .. "completed", jobId) then
    rcall("ZREM", prefix .. "completed", jobId)
    return "completed"
  elseif rcall("ZSCORE", prefix .. "waiting-children", jobId) then
    rcall("ZREM", prefix .. "waiting-children", jobId)
    return "waiting-children"
  elseif rcall("ZSCORE", prefix .. "delayed", jobId) then
    rcall("ZREM", prefix .. "delayed", jobId)
    return "delayed"
  elseif rcall("ZSCORE", prefix .. "failed", jobId) then
    rcall("ZREM", prefix .. "failed", jobId)
    return "failed"
  elseif rcall("ZSCORE", prefix .. "prioritized", jobId) then
    rcall("ZREM", prefix .. "prioritized", jobId)
    return "prioritized"
  -- We remove only 1 element from the list, since we assume they are not added multiple times
  elseif rcall("LREM", prefix .. "wait", 1, jobId) == 1 then
    return "wait"
  elseif rcall("LREM", prefix .. "paused", 1, jobId) == 1 then
    return "paused"
  elseif rcall("LREM", prefix .. "active", 1, jobId) == 1 then
    return "active"
  end
  return "unknown"
end
--[[
  Function to remove job keys.
]]
local function removeJobKeys(jobKey)
  return rcall("DEL", jobKey, jobKey .. ':logs', jobKey .. ':dependencies',
    jobKey .. ':processed', jobKey .. ':failed', jobKey .. ':unsuccessful')
end
--[[
  Check if this job has a parent. If so we will just remove it from
  the parent child list, but if it is the last child we should move the parent to "wait/paused"
  which requires code from "moveToFinished"
]]
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local function _moveParentToWait(parentPrefix, parentId, emitEvent)
  local isPausedOrMaxed =
    isQueuePausedOrMaxed(parentPrefix .. "meta", parentPrefix .. "active")
  addJobInTargetList(parentPrefix .. "wait", parentPrefix .. "marker", "RPUSH", isPausedOrMaxed, parentId)
  if emitEvent then
    local parentEventStream = parentPrefix .. "events"
    rcall("XADD", parentEventStream, "*", "event", "waiting", "jobId", parentId, "prev", "waiting-children")
  end
end
local function removeParentDependencyKey(jobKey, hard, parentKey, baseKey, debounceId)
  if parentKey then
    local parentDependenciesKey = parentKey .. ":dependencies"
    local result = rcall("SREM", parentDependenciesKey, jobKey)
    if result > 0 then
      local pendingDependencies = rcall("SCARD", parentDependenciesKey)
      if pendingDependencies == 0 then
        local parentId = getJobIdFromKey(parentKey)
        local parentPrefix = getJobKeyPrefix(parentKey, parentId)
        local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
        if numRemovedElements == 1 then
          if hard then -- remove parent in same queue
            if parentPrefix == baseKey then
              removeParentDependencyKey(parentKey, hard, nil, baseKey, nil)
              removeJobKeys(parentKey)
              if debounceId then
                rcall("DEL", parentPrefix .. "de:" .. debounceId)
              end
            else
              _moveParentToWait(parentPrefix, parentId)
            end
          else
            _moveParentToWait(parentPrefix, parentId, true)
          end
        end
      end
      return true
    end
  else
    local parentAttributes = rcall("HMGET", jobKey, "parentKey", "deid")
    local missedParentKey = parentAttributes[1]
    if( (type(missedParentKey) == "string") and missedParentKey ~= ""
      and (rcall("EXISTS", missedParentKey) == 1)) then
      local parentDependenciesKey = missedParentKey .. ":dependencies"
      local result = rcall("SREM", parentDependenciesKey, jobKey)
      if result > 0 then
        local pendingDependencies = rcall("SCARD", parentDependenciesKey)
        if pendingDependencies == 0 then
          local parentId = getJobIdFromKey(missedParentKey)
          local parentPrefix = getJobKeyPrefix(missedParentKey, parentId)
          local numRemovedElements = rcall("ZREM", parentPrefix .. "waiting-children", parentId)
          if numRemovedElements == 1 then
            if hard then
              if parentPrefix == baseKey then
                removeParentDependencyKey(missedParentKey, hard, nil, baseKey, nil)
                removeJobKeys(missedParentKey)
                if parentAttributes[2] then
                  rcall("DEL", parentPrefix .. "de:" .. parentAttributes[2])
                end
              else
                _moveParentToWait(parentPrefix, parentId)
              end
            else
              _moveParentToWait(parentPrefix, parentId, true)
            end
          end
        end
        return true
      end
    end
  end
  return false
end
--[[
  Function to recursively check if there are no locks
  on the jobs to be removed.
  returns:
    boolean
]]
local function isLocked( prefix, jobId, removeChildren)
  local jobKey = prefix .. jobId;
  -- Check if this job is locked
  local lockKey = jobKey .. ':lock'
  local lock = rcall("GET", lockKey)
  if not lock then
    if removeChildren == "1" then
      local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
      if (#dependencies > 0) then
        for i, childJobKey in ipairs(dependencies) do
          -- We need to get the jobId for this job.
          local childJobId = getJobIdFromKey(childJobKey)
          local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
          local result = isLocked( childJobPrefix, childJobId, removeChildren )
          if result then
            return true
          end
        end
      end
    end
    return false
  end
  return true
end
local removeJobChildren
local removeJobWithChildren
removeJobChildren = function(prefix, jobKey, options)
    -- Check if this job has children
    -- If so, we are going to try to remove the children recursively in a depth-first way
    -- because if some job is locked, we must exit with an error.
    if not options.ignoreProcessed then
        local processed = rcall("HGETALL", jobKey .. ":processed")
        if #processed > 0 then
            for i = 1, #processed, 2 do
                local childJobId = getJobIdFromKey(processed[i])
                local childJobPrefix = getJobKeyPrefix(processed[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
        local failed = rcall("HGETALL", jobKey .. ":failed")
        if #failed > 0 then
            for i = 1, #failed, 2 do
                local childJobId = getJobIdFromKey(failed[i])
                local childJobPrefix = getJobKeyPrefix(failed[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
        local unsuccessful = rcall("ZRANGE", jobKey .. ":unsuccessful", 0, -1)
        if #unsuccessful > 0 then
            for i = 1, #unsuccessful, 1 do
                local childJobId = getJobIdFromKey(unsuccessful[i])
                local childJobPrefix = getJobKeyPrefix(unsuccessful[i], childJobId)
                removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
            end
        end
    end
    local dependencies = rcall("SMEMBERS", jobKey .. ":dependencies")
    if #dependencies > 0 then
        for i, childJobKey in ipairs(dependencies) do
            local childJobId = getJobIdFromKey(childJobKey)
            local childJobPrefix = getJobKeyPrefix(childJobKey, childJobId)
            removeJobWithChildren(childJobPrefix, childJobId, jobKey, options)
        end
    end
end
removeJobWithChildren = function(prefix, jobId, parentKey, options)
    local jobKey = prefix .. jobId
    if options.ignoreLocked then
        if isLocked(prefix, jobId) then
            return
        end
    end
    -- Check if job is in the failed zset
    local failedSet = prefix .. "failed"
    if not (options.ignoreProcessed and rcall("ZSCORE", failedSet, jobId)) then
        removeParentDependencyKey(jobKey, false, parentKey, nil)
        if options.removeChildren then
            removeJobChildren(prefix, jobKey, options)
        end
        local prev = removeJobFromAnyState(prefix, jobId)
        local deduplicationId = rcall("HGET", jobKey, "deid")
        removeDeduplicationKeyIfNeededOnRemoval(prefix, jobId, deduplicationId)
        if removeJobKeys(jobKey) > 0 then
            local metaKey = prefix .. "meta"
            local maxEvents = getOrSetMaxEvents(metaKey)
            rcall("XADD", prefix .. "events", "MAXLEN", "~", maxEvents, "*", "event", "removed",
                "jobId", jobId, "prev", prev)
        end
    end
end
local prefix = ARGV[1]
local jobId = ARGV[2]
local jobKey = KEYS[1]
local metaKey = KEYS[2]
local options = {
  removeChildren = "1",
  ignoreProcessed = true,
  ignoreLocked = true
}
removeJobChildren(prefix, jobKey, options) 
`,keys:2};e.s(["removeUnprocessedChildren",0,rx],72997),e.i(72997);let rD={name:"reprocessJob",content:`--[[
  Attempts to reprocess a job
  Input:
    KEYS[1] job key
    KEYS[2] events stream
    KEYS[3] job state
    KEYS[4] wait key
    KEYS[5] meta
    KEYS[6] active key
    KEYS[7] marker key
    ARGV[1] job.id
    ARGV[2] (job.opts.lifo ? 'R' : 'L') + 'PUSH'
    ARGV[3] propVal - failedReason/returnvalue
    ARGV[4] prev state - failed/completed
    ARGV[5] reset attemptsMade - "1" or "0"
    ARGV[6] reset attemptsStarted - "1" or "0"
  Output:
     1 means the operation was a success
    -1 means the job does not exist
    -3 means the job was not found in the expected set.
]]
local rcall = redis.call;
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
local jobKey = KEYS[1]
if rcall("EXISTS", jobKey) == 1 then
  local jobId = ARGV[1]
  if (rcall("ZREM", KEYS[3], jobId) == 1) then
    local attributesToRemove = {}
    if ARGV[5] == "1" then
      table.insert(attributesToRemove, "atm")
    end
    if ARGV[6] == "1" then
      table.insert(attributesToRemove, "ats")
    end
    rcall("HDEL", jobKey, "finishedOn", "processedOn", ARGV[3], unpack(attributesToRemove))
    local isPausedOrMaxed = isQueuePausedOrMaxed(KEYS[5], KEYS[6])
    addJobInTargetList(KEYS[4], KEYS[7], ARGV[2], isPausedOrMaxed, jobId)
    local parentKey = rcall("HGET", jobKey, "parentKey")
    if parentKey and rcall("EXISTS", parentKey) == 1 then
      if ARGV[4] == "failed" then
        if rcall("ZREM", parentKey .. ":unsuccessful", jobKey) == 1 or
          rcall("HDEL", parentKey .. ":failed", jobKey) == 1 then
          rcall("SADD", parentKey .. ":dependencies", jobKey)
        end
      else
        if rcall("HDEL", parentKey .. ":processed", jobKey) == 1 then
          rcall("SADD", parentKey .. ":dependencies", jobKey)
        end
      end
    end
    local maxEvents = getOrSetMaxEvents(KEYS[5])
    -- Emit waiting event
    rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
      "jobId", jobId, "prev", ARGV[4]);
    return 1
  else
    return -3
  end
else
  return -1
end
`,keys:7};e.s(["reprocessJob",0,rD],12863),e.i(12863);let rC={name:"retryJob",content:`--[[
  Retries a failed job by moving it back to the wait queue.
    Input:
      KEYS[1]  'active',
      KEYS[2]  'wait'
      KEYS[3]  'paused'
      KEYS[4]  job key
      KEYS[5]  'meta'
      KEYS[6]  events stream
      KEYS[7]  delayed key
      KEYS[8]  prioritized key
      KEYS[9]  'pc' priority counter
      KEYS[10] 'marker'
      KEYS[11] 'stalled'
      ARGV[1]  key prefix
      ARGV[2]  timestamp
      ARGV[3]  pushCmd
      ARGV[4]  jobId
      ARGV[5]  token
      ARGV[6]  optional job fields to update
    Events:
      'waiting'
    Output:
     0  - OK
     -1 - Missing key
     -2 - Missing lock
     -3 - Job not in active set
]]
local rcall = redis.call
-- Includes
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
--[[
  Updates the delay set, by moving delayed jobs that should
  be processed now to "wait".
     Events:
      'waiting'
]]
-- Includes
-- Try to get as much as 1000 jobs at once
local function promoteDelayedJobs(delayedKey, markerKey, targetKey, prioritizedKey,
                                  eventStreamKey, prefix, timestamp, priorityCounterKey, isPaused)
    local jobs = rcall("ZRANGEBYSCORE", delayedKey, 0, (timestamp + 1) * 0x1000 - 1, "LIMIT", 0, 1000)
    if (#jobs > 0) then
        rcall("ZREM", delayedKey, unpack(jobs))
        for _, jobId in ipairs(jobs) do
            local jobKey = prefix .. jobId
            local priority =
                tonumber(rcall("HGET", jobKey, "priority")) or 0
            if priority == 0 then
                -- LIFO or FIFO
                rcall("LPUSH", targetKey, jobId)
            else
                local score = getPriorityScore(priority, priorityCounterKey)
                rcall("ZADD", prioritizedKey, score, jobId)
            end
            -- Emit waiting event
            rcall("XADD", eventStreamKey, "*", "event", "waiting", "jobId",
                  jobId, "prev", "delayed")
            rcall("HSET", jobKey, "delay", 0)
        end
        addBaseMarkerIfNeeded(markerKey, isPaused)
    end
end
local function removeLock(jobKey, stalledKey, token, jobId)
  if token ~= "0" then
    local lockKey = jobKey .. ':lock'
    local lockToken = rcall("GET", lockKey)
    if lockToken == token then
      rcall("DEL", lockKey)
      rcall("SREM", stalledKey, jobId)
    else
      if lockToken then
        -- Lock exists but token does not match
        return -6
      else
        -- Lock is missing completely
        return -2
      end
    end
  end
  return 0
end
--[[
  Function to update a bunch of fields in a job.
]]
local function updateJobFields(jobKey, msgpackedFields)
  if msgpackedFields and #msgpackedFields > 0 then
    local fieldsToUpdate = cmsgpack.unpack(msgpackedFields)
    if fieldsToUpdate then
      rcall("HMSET", jobKey, unpack(fieldsToUpdate))
    end
  end
end
local isPausedOrMaxed = isQueuePausedOrMaxed(KEYS[5], KEYS[1])
local markerKey = KEYS[10]
-- Check if there are delayed jobs that we can move to wait.
-- test example: when there are delayed jobs between retries
promoteDelayedJobs(KEYS[7], markerKey, KEYS[2], KEYS[8], KEYS[6], ARGV[1], ARGV[2], KEYS[9], isPausedOrMaxed)
local jobKey = KEYS[4]
if rcall("EXISTS", jobKey) == 1 then
  local errorCode = removeLock(jobKey, KEYS[11], ARGV[5], ARGV[4]) 
  if errorCode < 0 then
    return errorCode
  end
  updateJobFields(jobKey, ARGV[6])
  local numRemovedElements = rcall("LREM", KEYS[1], -1, ARGV[4])
  if (numRemovedElements < 1) then return -3 end
  local priority = tonumber(rcall("HGET", jobKey, "priority")) or 0
  --need to re-evaluate after removing job from active
  isPausedOrMaxed = isQueuePausedOrMaxed(KEYS[5], KEYS[1])
  -- Standard or priority add
  if priority == 0 then
    addJobInTargetList(KEYS[2], markerKey, ARGV[3], isPausedOrMaxed, ARGV[4])
  else
    addJobWithPriority(markerKey, KEYS[8], priority, ARGV[4], KEYS[9], isPausedOrMaxed)
  end
  rcall("HINCRBY", jobKey, "atm", 1)
  local maxEvents = getOrSetMaxEvents(KEYS[5])
  -- Emit waiting event
  rcall("XADD", KEYS[6], "MAXLEN", "~", maxEvents, "*", "event", "waiting",
    "jobId", ARGV[4], "prev", "active")
  return 0
else
  return -1
end
`,keys:11};e.s(["retryJob",0,rC],32559),e.i(32559);let rT={name:"saveStacktrace",content:`--[[
  Save stacktrace and failedReason.
  Input:
    KEYS[1] job key
    ARGV[1]  stacktrace
    ARGV[2]  failedReason
  Output:
     0 - OK
    -1 - Missing key
]]
local rcall = redis.call
if rcall("EXISTS", KEYS[1]) == 1 then
  rcall("HMSET", KEYS[1], "stacktrace", ARGV[1], "failedReason", ARGV[2])
  return 0
else
  return -1
end
`,keys:1};e.s(["saveStacktrace",0,rT],20332),e.i(20332);let rO={name:"updateData",content:`--[[
  Update job data
  Input:
    KEYS[1] Job id key
    ARGV[1] data
  Output:
    0 - OK
   -1 - Missing job.
]]
local rcall = redis.call
if rcall("EXISTS",KEYS[1]) == 1 then -- // Make sure job exists
  rcall("HSET", KEYS[1], "data", ARGV[1])
  return 0
else
  return -1
end
`,keys:1};e.s(["updateData",0,rO],47479),e.i(47479);let rR={name:"updateJobScheduler",content:`--[[
  Updates a job scheduler and adds next delayed job
  Input:
    KEYS[1]  'repeat' key
    KEYS[2]  'delayed'
    KEYS[3]  'wait' key
    KEYS[4]  'paused' key
    KEYS[5]  'meta'
    KEYS[6]  'prioritized' key
    KEYS[7]  'marker',
    KEYS[8]  'id'
    KEYS[9]  events stream key
    KEYS[10] 'pc' priority counter
    KEYS[11] producer key
    KEYS[12] 'active' key
    ARGV[1] next milliseconds
    ARGV[2] jobs scheduler id
    ARGV[3] Json stringified delayed data
    ARGV[4] msgpacked delayed opts
    ARGV[5] timestamp
    ARGV[6] prefix key
    ARGV[7] producer id
    Output:
      next delayed job id  - OK
]] local rcall = redis.call
local repeatKey = KEYS[1]
local delayedKey = KEYS[2]
local waitKey = KEYS[3]
local pausedKey = KEYS[4]
local metaKey = KEYS[5]
local prioritizedKey = KEYS[6]
local nextMillis = tonumber(ARGV[1])
local jobSchedulerId = ARGV[2]
local timestamp = tonumber(ARGV[5])
local prefixKey = ARGV[6]
local producerId = ARGV[7]
local jobOpts = cmsgpack.unpack(ARGV[4])
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Shared helper to store a job and enqueue it into the appropriate list/set.
  Handles delayed, prioritized, and standard (LIFO/FIFO) jobs.
  Emits the appropriate event after enqueuing ("delayed" or "waiting").
  Returns delay, priority from storeJob.
]]
-- Includes
--[[
  Adds a delayed job to the queue by doing the following:
    - Creates a new job key with the job data.
    - adds to delayed zset.
    - Emits a global event 'delayed' if the job is delayed.
]]
-- Includes
--[[
  Add delay marker if needed.
]]
-- Includes
--[[
  Function to return the next delayed job timestamp.
]]
local function getNextDelayedTimestamp(delayedKey)
  local result = rcall("ZRANGE", delayedKey, 0, 0, "WITHSCORES")
  if #result then
    local nextTimestamp = tonumber(result[2])
    if nextTimestamp ~= nil then
      return nextTimestamp / 0x1000
    end
  end
end
local function addDelayMarkerIfNeeded(markerKey, delayedKey)
  local nextTimestamp = getNextDelayedTimestamp(delayedKey)
  if nextTimestamp ~= nil then
    -- Replace the score of the marker with the newest known
    -- next timestamp.
    rcall("ZADD", markerKey, nextTimestamp, "1")
  end
end
--[[
  Bake in the job id first 12 bits into the timestamp
  to guarantee correct execution order of delayed jobs
  (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
  WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
]]
local function getDelayedScore(delayedKey, timestamp, delay)
  local delayedTimestamp = (delay > 0 and (tonumber(timestamp) + delay)) or tonumber(timestamp)
  local minScore = delayedTimestamp * 0x1000
  local maxScore = (delayedTimestamp + 1 ) * 0x1000 - 1
  local result = rcall("ZREVRANGEBYSCORE", delayedKey, maxScore,
    minScore, "WITHSCORES","LIMIT", 0, 1)
  if #result then
    local currentMaxScore = tonumber(result[2])
    if currentMaxScore ~= nil then
      if currentMaxScore >= maxScore then
        return maxScore, delayedTimestamp
      else
        return currentMaxScore + 1, delayedTimestamp
      end
    end
  end
  return minScore, delayedTimestamp
end
local function addDelayedJob(jobId, delayedKey, eventsKey, timestamp,
  maxEvents, markerKey, delay)
  local score, delayedTimestamp = getDelayedScore(delayedKey, timestamp, tonumber(delay))
  rcall("ZADD", delayedKey, score, jobId)
  rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "delayed",
    "jobId", jobId, "delay", delayedTimestamp)
  -- mark that a delayed job is available
  addDelayMarkerIfNeeded(markerKey, delayedKey)
end
--[[
  Function to add job in target list and add marker if needed.
]]
-- Includes
--[[
  Add marker if needed when a job is available.
]]
local function addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
  if not isPausedOrMaxed then
    rcall("ZADD", markerKey, 0, "0")
  end  
end
local function addJobInTargetList(targetKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
  rcall(pushCmd, targetKey, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to add job considering priority.
]]
-- Includes
--[[
  Function to get priority score.
]]
local function getPriorityScore(priority, priorityCounterKey)
  local prioCounter = rcall("INCR", priorityCounterKey)
  return priority * 0x100000000 + prioCounter % 0x100000000
end
local function addJobWithPriority(markerKey, prioritizedKey, priority, jobId, priorityCounterKey,
  isPausedOrMaxed)
  local score = getPriorityScore(priority, priorityCounterKey)
  rcall("ZADD", prioritizedKey, score, jobId)
  addBaseMarkerIfNeeded(markerKey, isPausedOrMaxed)
end
--[[
  Function to check if queue is paused or maxed
  (since an empty list and !EXISTS are not really the same).
]]
local function isQueuePausedOrMaxed(queueMetaKey, activeKey)
  local queueAttributes = rcall("HMGET", queueMetaKey, "paused", "concurrency")
  if queueAttributes[1] then
    return true
  else
    if queueAttributes[2] then
      local activeCount = rcall("LLEN", activeKey)
      return activeCount >= tonumber(queueAttributes[2])
    end
  end
  return false
end
--[[
  Function to store a job
]]
local function storeJob(eventsKey, jobIdKey, jobId, name, data, opts, timestamp,
                        parentKey, parentData, repeatJobKey)
    local jsonOpts = cjson.encode(opts)
    local delay = opts['delay'] or 0
    local priority = opts['priority'] or 0
    local debounceId = opts['de'] and opts['de']['id']
    local optionalValues = {}
    if parentKey ~= nil then
        table.insert(optionalValues, "parentKey")
        table.insert(optionalValues, parentKey)
        table.insert(optionalValues, "parent")
        table.insert(optionalValues, parentData)
    end
    if repeatJobKey then
        table.insert(optionalValues, "rjk")
        table.insert(optionalValues, repeatJobKey)
    end
    if debounceId then
        table.insert(optionalValues, "deid")
        table.insert(optionalValues, debounceId)
    end
    rcall("HMSET", jobIdKey, "name", name, "data", data, "opts", jsonOpts,
          "timestamp", timestamp, "delay", delay, "priority", priority,
          unpack(optionalValues))
    rcall("XADD", eventsKey, "*", "event", "added", "jobId", jobId, "name", name)
    return delay, priority
end
local function storeAndEnqueueJob(eventsKey, jobIdKey, jobId, name, data, opts,
    timestamp, parentKey, parentData, repeatJobKey, maxEvents,
    waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
    priorityCounterKey, delayedKey, markerKey)
  local delay, priority = storeJob(eventsKey, jobIdKey, jobId, name, data,
      opts, timestamp, parentKey, parentData, repeatJobKey)
  if delay ~= 0 and delayedKey then
    addDelayedJob(jobId, delayedKey, eventsKey, timestamp, maxEvents, markerKey, delay)
  else
    local isPausedOrMaxed = isQueuePausedOrMaxed(metaKey, activeKey)
    if priority > 0 then
      addJobWithPriority(markerKey, prioritizedKey, priority, jobId,
          priorityCounterKey, isPausedOrMaxed)
    else
      local pushCmd = opts['lifo'] and 'RPUSH' or 'LPUSH'
      addJobInTargetList(waitKey, markerKey, pushCmd, isPausedOrMaxed, jobId)
    end
    rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "waiting",
        "jobId", jobId)
  end
  return delay, priority
end
local function addJobFromScheduler(jobKey, jobId, opts, waitKey, pausedKey, activeKey, metaKey, 
  prioritizedKey, priorityCounter, delayedKey, markerKey, eventsKey, name, maxEvents, timestamp,
  data, jobSchedulerId, repeatDelay)
  opts['delay'] = repeatDelay
  opts['jobId'] = jobId
  storeAndEnqueueJob(eventsKey, jobKey, jobId, name, data, opts,
      timestamp, nil, nil, jobSchedulerId, maxEvents,
      waitKey, pausedKey, activeKey, metaKey, prioritizedKey,
      priorityCounter, delayedKey, markerKey)
end
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
local function getJobSchedulerEveryNextMillis(prevMillis, every, now, offset, startDate)
    offset = tonumber(offset)
    local nextMillis
    if not prevMillis then
        if startDate then
            -- Assuming startDate is passed as milliseconds from JavaScript
            nextMillis = tonumber(startDate)
            nextMillis = nextMillis > now and nextMillis or now
        else
            if offset and offset > 0 then
                -- Align to the next slot that respects the offset
                nextMillis = math.floor(now / every) * every + offset
                if nextMillis <= now then
                    nextMillis = nextMillis + every
                end
            else
                nextMillis = now
            end
        end
    else
        nextMillis = prevMillis + every
        -- check if we may have missed some iterations
        if nextMillis < now then
            -- Use the same offset-aware alignment as the initial branch
            -- above so a non-zero offset is preserved across catch-ups
            -- instead of being flattened to (slot + every). When the
            -- aligned slot is itself still in the past, advance by one
            -- full interval; otherwise the aligned slot is the next
            -- iteration.
            local aligned = math.floor(now / every) * every + (offset or 0)
            if aligned <= now then
                nextMillis = aligned + every
            else
                nextMillis = aligned
            end
        end
    end
    if not offset or offset == 0 then
        local timeSlot = math.floor(nextMillis / every) * every;
        offset = nextMillis - timeSlot;
    end
    -- Return a tuple nextMillis, offset
    return math.floor(nextMillis), math.floor(offset)
end
local prevMillis = rcall("ZSCORE", repeatKey, jobSchedulerId)
-- Validate that scheduler exists.
-- If it does not exist we should not iterate anymore.
if prevMillis then
    prevMillis = tonumber(prevMillis)
    local schedulerKey = repeatKey .. ":" .. jobSchedulerId
    local schedulerAttributes = rcall("HMGET", schedulerKey, "name", "data", "every", "startDate", "offset")
    local every = tonumber(schedulerAttributes[3])
    local now = tonumber(timestamp)
    -- If every is not found in scheduler attributes, try to get it from job options
    if not every and jobOpts['repeat'] and jobOpts['repeat']['every'] then
        every = tonumber(jobOpts['repeat']['every'])
    end
    if every then
        local startDate = schedulerAttributes[4]
        local jobOptsOffset = jobOpts['repeat'] and jobOpts['repeat']['offset'] or 0
        local offset = schedulerAttributes[5] or jobOptsOffset or 0
        local newOffset
        nextMillis, newOffset = getJobSchedulerEveryNextMillis(prevMillis, every, now, offset, startDate)
        if not offset then
            rcall("HSET", schedulerKey, "offset", newOffset)
            jobOpts['repeat']['offset'] = newOffset
        end
    end
    local nextDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. nextMillis
    local nextDelayedJobKey = schedulerKey .. ":" .. nextMillis
    local currentDelayedJobId = "repeat:" .. jobSchedulerId .. ":" .. prevMillis
    if producerId == currentDelayedJobId then
        local eventsKey = KEYS[9]
        local maxEvents = getOrSetMaxEvents(metaKey)
        if rcall("EXISTS", nextDelayedJobKey) ~= 1 then
            rcall("ZADD", repeatKey, nextMillis, jobSchedulerId)
            rcall("HINCRBY", schedulerKey, "ic", 1)
            rcall("INCR", KEYS[8])
            local templateData = schedulerAttributes[2]
            local delay = nextMillis - now
            -- Fast Clamp delay to minimum of 0
            if delay < 0 then
                delay = 0
            end
            jobOpts["delay"] = delay
            addJobFromScheduler(nextDelayedJobKey, nextDelayedJobId, jobOpts, waitKey, pausedKey, KEYS[12], metaKey,
                prioritizedKey, KEYS[10], delayedKey, KEYS[7], eventsKey, schedulerAttributes[1], maxEvents, ARGV[5],
                templateData or '{}', jobSchedulerId, delay)
            return nextDelayedJobId .. "" -- convert to string
        else
            rcall("XADD", eventsKey, "MAXLEN", "~", maxEvents, "*", "event", "duplicated", "jobId", nextDelayedJobId)
        end
    end
end
`,keys:12};e.s(["updateJobScheduler",0,rR],74677),e.i(74677);let rA={name:"updateProgress",content:`--[[
  Update job progress
  Input:
    KEYS[1] Job id key
    KEYS[2] event stream key
    KEYS[3] meta key
    ARGV[1] id
    ARGV[2] progress
  Output:
     0 - OK
    -1 - Missing job.
  Event:
    progress(jobId, progress)
]]
local rcall = redis.call
-- Includes
--[[
  Function to get max events value or set by default 10000.
]]
local function getOrSetMaxEvents(metaKey)
  local maxEvents = rcall("HGET", metaKey, "opts.maxLenEvents")
  if not maxEvents then
    maxEvents = 10000
    rcall("HSET", metaKey, "opts.maxLenEvents", maxEvents)
  end
  return maxEvents
end
if rcall("EXISTS", KEYS[1]) == 1 then -- // Make sure job exists
    local maxEvents = getOrSetMaxEvents(KEYS[3])
    rcall("HSET", KEYS[1], "progress", ARGV[2])
    rcall("XADD", KEYS[2], "MAXLEN", "~", maxEvents, "*", "event", "progress",
          "jobId", ARGV[1], "data", ARGV[2]);
    return 0
else
    return -1
end
`,keys:3};e.s(["updateProgress",0,rA],70855),e.i(70855),e.s(["addDelayedJob",0,tH,"addJobScheduler",0,tB,"addLog",0,tZ,"addParentJob",0,tX,"addPrioritizedJob",0,tQ,"addStandardJob",0,t0,"changeDelay",0,t1,"changePriority",0,t2,"cleanJobsInSet",0,t3,"drain",0,t4,"extendLock",0,t6,"extendLocks",0,t5,"getCounts",0,t8,"getCountsPerPriority",0,t9,"getDependencyCounts",0,t7,"getJobScheduler",0,re,"getJobs",0,rt,"getMetrics",0,rr,"getRanges",0,rn,"getRateLimitTtl",0,ri,"getState",0,ra,"getStateV2",0,rs,"isFinished",0,ro,"isJobInList",0,rl,"isMaxed",0,rd,"moveJobFromActiveToWait",0,rc,"moveJobsToWait",0,ru,"moveStalledJobsToWait",0,rh,"moveToActive",0,rp,"moveToDelayed",0,rm,"moveToFinished",0,ry,"moveToWaitingChildren",0,rf,"obliterate",0,rb,"paginate",0,rg,"pause",0,rK,"promote",0,rv,"releaseLock",0,rE,"removeChildDependency",0,rI,"removeDeduplicationKey",0,rw,"removeJob",0,rS,"removeJobScheduler",0,rk,"removeOrphanedJobs",0,rj,"removeUnprocessedChildren",0,rx,"reprocessJob",0,rD,"retryJob",0,rC,"saveStacktrace",0,rT,"updateData",0,rO,"updateJobScheduler",0,rR,"updateProgress",0,rA],28729);var rM=e.i(28729);let rN=new WeakMap;function rP(e){if(!0===e.__bullmq_iredis)return e;let t=rN.get(e);if(t)return t;let r=!0===e.isCluster,n=new Map,i=Object.create(null);i.__bullmq_iredis=!0,i.isCluster=r,i.runCommand=(t,r)=>e[t](r),i.pipeline=(...t)=>rJ(e.pipeline(...t)),i.multi=(...t)=>rJ(e.multi(...t)),"function"==typeof e.duplicate&&(i.duplicate=t=>{var n;if(r){let r=(null==(n=e.options)?void 0:n.redisOptions)||{},i=t?Object.assign(Object.assign({},r),t):r;return rP(e.duplicate(void 0,{redisOptions:i}))}return rP(e.duplicate(t))}),i.hset=(t,r,...n)=>{if("string"==typeof r)return e.hset(t,r,...n);let i=[t];for(let[e,t]of Object.entries(r))i.push(e,t);return e.hset(...i)},i.set=(t,r,n,...i)=>{if("string"==typeof n||null==n)return e.set(t,r,...null!=n?[n,...i]:[]);let a=[t,r];return null!=n.PX?a.push("PX",n.PX):null!=n.EX&&a.push("EX",n.EX),e.set(...a)},i.zrange=(t,r,n,i,...a)=>"string"==typeof i?e.zrange(t,r,n,i,...a):(null==i?void 0:i.WITHSCORES)?e.zrange(t,r,n,"WITHSCORES"):e.zrange(t,r,n),i.zrevrange=(t,r,n,i,...a)=>"string"==typeof i?e.zrevrange(t,r,n,i,...a):(null==i?void 0:i.WITHSCORES)?e.zrevrange(t,r,n,"WITHSCORES"):e.zrevrange(t,r,n),i.xadd=(t,r,n,...i)=>{if("string"==typeof n)return e.xadd(t,r,n,...i);let a=i[0],s=[t];for(let[e,t]of((null==a?void 0:a.MAXLEN)!=null&&(s.push("MAXLEN"),!1!==a.approximate&&s.push("~"),s.push(a.MAXLEN)),s.push(r),Object.entries(n)))s.push(e,t);return e.xadd(...s)},i.xread=(t,...r)=>{if("string"==typeof t)return e.xread(t,...r);let n=r[0],i=[];for(let e of((null==n?void 0:n.BLOCK)!=null&&i.push("BLOCK",n.BLOCK),(null==n?void 0:n.COUNT)!=null&&i.push("COUNT",n.COUNT),i.push("STREAMS"),t))i.push(e.key);for(let e of t)i.push(e.id);return e.xread(...i)},i.xtrim=(t,r,n,...i)=>{if("string"==typeof n||0===i.length)return e.xtrim(t,r,n,...i);let a=i[0],s=[t,r];return(null==a?void 0:a.approximate)!==!1&&s.push("~"),s.push(n),e.xtrim(...s)},i.clientSetName=t=>e.client("SETNAME",t),i.clientList=()=>e.client("LIST"),i.scan=(t,...r)=>{if(0===r.length||"string"==typeof r[0]||"function"==typeof r[0])return e.scan(t,...r);let n=r[0],i=[t];return(null==n?void 0:n.MATCH)!=null&&i.push("MATCH",n.MATCH),(null==n?void 0:n.COUNT)!=null&&i.push("COUNT",n.COUNT),e.scan(...i)};let a=new Proxy(e,{get(e,t){if(t in i)return i[t];let r=Reflect.get(e,t,e);if("function"!=typeof r)return r;if(Object.prototype.hasOwnProperty.call(e,t))return r.bind(e);let a=n.get(t);if(void 0!==a)return a;let s=r.bind(e);return n.set(t,s),s},set:(e,t,r)=>t in i?(i[t]=r,!0):(n.delete(t),Reflect.set(e,t,r)),deleteProperty:(e,t)=>!(t in i)&&(n.delete(t),Reflect.deleteProperty(e,t)),has:(e,t)=>t in i||Reflect.has(e,t)});return rN.set(e,a),a}function rJ(e){e.runCommand=function(t,r){return e[t](r),e};let t=e.hset.bind(e);e.hset=function(r,n){let i=[r];for(let[e,t]of Object.entries(n))i.push(e,t);return t(...i),e};let r=e.hscan.bind(e);e.hscan=function(t,n,i){return(null==i?void 0:i.COUNT)!=null?r(t,n,"COUNT",i.COUNT):r(t,n),e};let n=e.sscan.bind(e);return e.sscan=function(t,r,i){return(null==i?void 0:i.COUNT)!=null?n(t,r,"COUNT",i.COUNT):n(t,r),e},e}function rL(e){return!!e&&"object"==typeof e&&(!0===e.__bullmq_iredis||"function"==typeof e.runCommand&&"function"==typeof e.defineCommand&&"function"==typeof e.pipeline&&"function"==typeof e.multi&&"function"==typeof e.duplicate&&"function"==typeof e.scanStream&&"function"==typeof e.connect&&"function"==typeof e.disconnect&&"function"==typeof e.on&&"string"==typeof e.status&&"boolean"==typeof e.isCluster)}e.s(["createIORedisClient",0,rP,"isIRedisClient",0,rL],28290);var rq=q;function rF(e){return 1===e.length&&Array.isArray(e[0])?e[0]:e}function rV(e){return(null==e?void 0:e.message)==="Disconnects client"||(null==e?void 0:e.message)==="The client is closed"||(null==e?void 0:e.message)==="Connection is closed."}function r_(e){return new rG(e)}class rG extends rq.EventEmitter{get status(){return this.statusOverride?this.statusOverride:this.raw.isReady?"ready":this.raw.isOpen?"connect":this.hasConnected?"end":"wait"}set status(e){if("end"===e&&(this.destroying=!0,this.raw.isOpen))try{this.raw.quit().catch(()=>{})}catch(e){}this.statusOverride=e}get options(){var e;return null!=(e=this.raw.options)?e:{}}set options(e){}constructor(e){super(),this.raw=e,this.scripts=new Map,this.hasConnected=!1,this.destroying=!1,this.isCluster=!1,e.on("ready",()=>{this.hasConnected=!0,this.connectionName?this.raw.clientSetName(this.connectionName).then(()=>this.emit("ready"),()=>this.emit("ready")):this.emit("ready")}),e.on("error",e=>{this.destroying&&rV(e)||this.emit("error",e)}),e.on("end",()=>this.emit("close")),e.on("reconnecting",()=>this.emit("reconnecting")),e.isOpen||(this.connectPromise=e.connect().then(()=>{this.connectPromise=void 0},e=>{this.connectPromise=void 0}))}async connect(){return this.connectPromise?this.connectPromise:this.raw.isOpen?void(!this.raw.isReady&&await new Promise((e,t)=>{let r=()=>{a(),e()},n=e=>{a(),t(e)},i=()=>{a(),t(Error("Connection ended before ready event"))},a=()=>{this.off("ready",r),this.off("error",n),this.off("end",i)};this.once("ready",r),this.once("error",n),this.once("end",i)})):(this.connectPromise=this.raw.connect().then(()=>{this.connectPromise=void 0},e=>{throw this.connectPromise=void 0,e}),this.connectPromise)}disconnect(e=!1){this.destroying=!0,e||(this.statusOverride="end");try{this.raw.isOpen&&this.raw.destroy()}catch(e){}this.emit("close"),e?(this.statusOverride=void 0,this.emit("reconnecting"),this.connect().catch(e=>{rV(e)||this.emit("error",e)}).finally(()=>{this.destroying=!1})):this.emit("end")}async quit(){if(this.destroying||"end"===this.statusOverride)return setImmediate(()=>{this.emit("end"),this.emit("close")}),"OK";this.destroying=!0;try{if(this.raw.isOpen)try{await this.raw.quit()}catch(e){}}catch(e){}return this.statusOverride="end",setImmediate(()=>{this.emit("end"),this.emit("close")}),"OK"}duplicate(...e){let t=new rG(this.raw.duplicate());for(let[e,r]of this.scripts)t.scripts.set(e,r),t[e]=(...r)=>t.runCommand(e,r);let r=e[0];return r&&"object"==typeof r&&r.connectionName&&(t.connectionName=r.connectionName),t}defineCommand(e,t){let r=(0,z.createHash)("sha1").update(t.lua).digest("hex");this.scripts.set(e,{sha:r,lua:t.lua,numberOfKeys:t.numberOfKeys}),this[e]=(...t)=>this.runCommand(e,t),this.raw.scriptLoad(t.lua).catch(()=>{})}async runCommand(e,t){var r,n;let i=this.scripts.get(e);if(!i)throw Error(`BullMQ: unknown command "${e}"`);let a=rF(t),{sha:s,lua:o,numberOfKeys:l}=i,d=a.slice(0,l).map(String),c=a.slice(l).map(e=>Buffer.isBuffer(e)?e:null==e?"":String(e));try{return await this.raw.evalSha(s,{keys:d,arguments:c})}catch(e){if(this.destroying&&rV(e))return null;if(rV(e))throw new B(e.message,e);if(null==(n=null==(r=null==e?void 0:e.message)?void 0:r.includes)?void 0:n.call(r,"NOSCRIPT"))try{return await this.raw.eval(o,{keys:d,arguments:c})}catch(e){if(this.destroying&&rV(e))return null;if(rV(e))throw new B(e.message,e);throw e}throw e}}multi(){return new rY(this.raw.multi(),this.scripts)}pipeline(){return this.multi()}async hgetall(e){let t=await this.raw.hGetAll(e);return null!=t?t:{}}async hget(e,t){var r;return null!=(r=await this.raw.hGet(e,t))?r:null}async hmget(e,...t){return(await this.raw.hmGet(e,t)).map(e=>null!=e?e:null)}async hset(e,t,...r){if("object"==typeof t)return await this.raw.hSet(e,t);let n={};n[t]=String(r[0]);for(let e=1;e<r.length;e+=2)n[String(r[e])]=String(r[e+1]);return await this.raw.hSet(e,n)}async hdel(e,...t){return await this.raw.hDel(e,t)}async hexists(e,t){return+!!await this.raw.hExists(e,t)}async get(e){var t;return null!=(t=await this.raw.get(e))?t:null}async set(e,t,r){let n={};return(null==r?void 0:r.PX)!=null?n.PX=r.PX:(null==r?void 0:r.EX)!=null&&(n.EX=r.EX),await this.raw.set(e,String(t),n)}async del(...e){return 0===e.length?0:await this.raw.del(e)}async zrange(e,t,r,n){if(null==n?void 0:n.WITHSCORES){let n=await this.raw.zRangeWithScores(e,t,r),i=[];for(let e of n)i.push(e.value,String(e.score));return i}return await this.raw.zRange(e,t,r)}async zrevrange(e,t,r,n){if(null==n?void 0:n.WITHSCORES){let n=await this.raw.zRangeWithScores(e,t,r,{REV:!0}),i=[];for(let e of n)i.push(e.value,String(e.score));return i}return await this.raw.zRange(e,t,r,{REV:!0})}async zcard(e){return await this.raw.zCard(e)}async zscore(e,t){let r=await this.raw.zScore(e,t);return null!=r?String(r):null}async lrange(e,t,r){return await this.raw.lRange(e,t,r)}async llen(e){return await this.raw.lLen(e)}async ltrim(e,t,r){return await this.raw.lTrim(e,t,r),"OK"}async lpos(e,t){var r;return null!=(r=await this.raw.lPos(e,t))?r:null}async smembers(e){return await this.raw.sMembers(e)}async xadd(e,t,r,n){let i={};(null==n?void 0:n.MAXLEN)!=null&&(i.TRIM={strategy:"MAXLEN",threshold:n.MAXLEN,strategyModifier:!1===n.approximate?void 0:"~"});let a={};for(let[e,t]of Object.entries(r))a[e]=String(t);return await this.raw.xAdd(e,t,a,i)}async xread(e,t){let r,n={};(null==t?void 0:t.BLOCK)!=null&&(n.BLOCK=t.BLOCK),(null==t?void 0:t.COUNT)!=null&&(n.COUNT=t.COUNT);let i=e.map(e=>({key:e.key,id:e.id}));try{r=await this.raw.xRead(i,n)}catch(e){if(this.destroying&&rV(e))return null;if(rV(e))throw new B(e.message,e);throw e}return r?r.map(e=>[e.name,e.messages.map(e=>[e.id,Object.entries(e.message).flat()])]):null}async xtrim(e,t,r,n){let i=(null==n?void 0:n.approximate)===!1?void 0:"~";return await this.raw.xTrim(e,t,r,{strategyModifier:i})}async bzpopmin(e,t){let r;try{r=await this.raw.bzPopMin(e,t)}catch(e){if(this.destroying&&rV(e))return null;if(rV(e))throw new B(e.message,e);throw e}return r?[r.key,r.value,String(r.score)]:null}async info(){return await this.raw.info()}async clientSetName(e){return await this.raw.clientSetName(e)}async clientList(){return await this.raw.sendCommand(["CLIENT","LIST"])}async scan(e,t){let r={};(null==t?void 0:t.MATCH)&&(r.MATCH=t.MATCH),(null==t?void 0:t.COUNT)&&(r.COUNT=t.COUNT);let n=await this.raw.scan(String(e),r);return[String(n.cursor),n.keys]}scanStream(e){let t=this.raw,r=this.connectPromise,n={};e.match&&(n.MATCH=e.match),e.count&&(n.COUNT=e.count);let i=new tM.Readable({objectMode:!0,async read(){var e,a,s,o;try{r&&await r;try{for(var l,d=!0,c=(0,tU.__asyncValues)(t.scanIterator(n));!(e=(l=await c.next()).done);d=!0)if(o=l.value,d=!1,!i.push(Array.isArray(o)?o:[o]))return}catch(e){a={error:e}}finally{try{!d&&!e&&(s=c.return)&&await s.call(c)}finally{if(a)throw a.error}}i.push(null)}catch(e){i.destroy(e)}}});return i}async keys(e){return await this.raw.keys(e)}async exists(...e){return 0===e.length?0:await this.raw.exists(e)}async zadd(e,...t){let r=[];for(let e=0;e<t.length;e+=2)r.push({score:Number(t[e]),value:String(t[e+1])});return await this.raw.zAdd(e,r)}async zrem(e,...t){return await this.raw.zRem(e,t)}async xlen(e){return await this.raw.xLen(e)}async xrevrange(e,t,r,...n){let i={};return"COUNT"===n[0]&&(i.COUNT=Number(n[1])),(await this.raw.xRevRange(e,t,r,i)).map(e=>[e.id,Object.entries(e.message).flat()])}async sadd(e,...t){return await this.raw.sAdd(e,t.map(String))}async scard(e){return await this.raw.sCard(e)}async lpush(e,...t){return await this.raw.lPush(e,t)}async rpop(e){return await this.raw.rPop(e)}async incr(e){return await this.raw.incr(e)}async incrby(e,t){return await this.raw.incrBy(e,t)}async flushall(){return await this.raw.flushAll()}}class rY{constructor(e,t){this.raw=e,this.scripts=t,this.transformers=[]}addIdentityTransformer(){this.transformers.push(e=>e)}hgetall(e){return this.raw.hGetAll(e),this.addIdentityTransformer(),this}hset(e,t){return this.raw.hSet(e,t),this.addIdentityTransformer(),this}hscan(e,t,r){let n={};return(null==r?void 0:r.COUNT)!=null&&(n.COUNT=r.COUNT),this.raw.hScan(e,String(t),n),this.transformers.push(e=>{if(!e)return["0",[]];let t=[];for(let r of e.entries||[])t.push(r.field,r.value);return[String(e.cursor),t]}),this}smembers(e){return this.raw.sMembers(e),this.addIdentityTransformer(),this}sscan(e,t,r){let n={};return(null==r?void 0:r.COUNT)!=null&&(n.COUNT=r.COUNT),this.raw.sScan(e,String(t),n),this.transformers.push(e=>e?[String(e.cursor),e.members||[]]:["0",[]]),this}zrange(e,t,r){return this.raw.zRange(e,t,r),this.addIdentityTransformer(),this}lrange(e,t,r){return this.raw.lRange(e,t,r),this.addIdentityTransformer(),this}llen(e){return this.raw.lLen(e),this.addIdentityTransformer(),this}del(...e){return e.length>0&&(this.raw.del(e),this.addIdentityTransformer()),this}runCommand(e,t){let r=this.scripts.get(e);if(!r)throw Error(`BullMQ: unknown command "${e}" in transaction`);let n=rF(t),{sha:i,lua:a,numberOfKeys:s}=r,o=n.slice(0,s).map(String),l=n.slice(s).map(e=>Buffer.isBuffer(e)?e:null==e?"":String(e));return this.raw.evalSha(i,{keys:o,arguments:l}),this.addIdentityTransformer(),this}async exec(){let e=await this.raw.exec();return e?e.map((e,t)=>{if(e instanceof Error)return[e,null];let r=this.transformers[t];return[null,r?r(e):e]}):null}}e.s(["createNodeRedisClient",0,r_],96094);var r$=q;function rW(e){return 1===e.length&&Array.isArray(e[0])?e[0]:e}function rU(e){return null==e?[]:Array.isArray(e)?e.map(String):e instanceof Set?Array.from(e,e=>String(e)):[]}function rz(e,t){return new rH(e,t)}class rH extends r$.EventEmitter{get status(){var e;return this.statusOverride?this.statusOverride:this.closed?"end":this.ready?"ready":(null==(e=this.raw)?void 0:e.connected)?"connect":this.hasConnected?"end":"wait"}set status(e){"end"===e&&(this.closing=!0,this.closed=!0),this.statusOverride=e}get options(){return{}}set options(e){}constructor(e,t){super(),this.raw=e,this.scripts=new Map,this.loadedScriptShas=new Set,this.hasConnected=!1,this.closed=!1,this.closing=!1,this.reconnecting=!1,this.reconnectTimer=null,this.reconnectAttempts=0,this.maxReconnectDelay=2e4,this.ready=!1,this.isCluster=!1,this.rawFactory=null==t?void 0:t.rawFactory,this.raw&&this._setupCallbacks(),(null==t?void 0:t.lazyConnect)||this.connect().catch(()=>{})}_setupCallbacks(){this.raw.onconnect=()=>{this._handleConnected()},this.raw.onclose=e=>{if(this.ready=!1,this.closing){this.closed=!0,this.emit("close"),this.emit("end");return}this.closed=!0,this.emit("close"),e&&this.emit("error",e),this._scheduleReconnect()}}_handleConnected(){this.hasConnected=!0,this.ready=!1,this.closed=!1,this.closing=!1,this.reconnecting=!1,this.reconnectAttempts=0,this.statusOverride=void 0,this.loadedScriptShas.clear();let e=()=>{this.ready=!0,this.emit("ready")},t=this.connectionName?this.clientSetName(this.connectionName).then(e,e):(e(),Promise.resolve());return this.readying=t.finally(()=>{this.readying===t&&(this.readying=void 0)}),this.readying}_scheduleReconnect(){if(this.closing||this.reconnecting)return;this.reconnecting=!0,this.reconnectAttempts++;let e=Math.max(Math.min(100*Math.exp(this.reconnectAttempts),this.maxReconnectDelay),1e3);this.reconnectTimer=setTimeout(async()=>{if(this.reconnectTimer=null,this.closing){this.reconnecting=!1;return}try{let e=this.raw?await this._duplicateRaw(this.raw):await this.rawFactory();this.rawFactory=void 0,this.raw=e,this.closed=!1,this.connecting=void 0,this._setupCallbacks(),await e.connect()}catch(e){this.reconnecting=!1,this.closing||this._scheduleReconnect()}},e)}async connect(){var e,t;!this.raw&&(this.rawFactory||this.materializing)&&await this._materializeRaw();let r=this.hasConnected&&(this.closed||!this.raw.connected);if(this.reconnectTimer&&(clearTimeout(this.reconnectTimer),this.reconnectTimer=null),this.reconnecting=!1,this.raw.connected&&!r){this.hasConnected=!0,this.closed=!1,this.closing=!1,this.statusOverride=void 0,this.ready||await (null!=(e=this.readying)?e:this._handleConnected());return}this.connecting||(this.closed=!1,this.closing=!1,this.statusOverride=void 0,r&&(this.raw=await this._duplicateRaw(this.raw),this._setupCallbacks()),this.connecting=this.raw.connect().then(()=>{this.hasConnected=!0,this.closed=!1,this.closing=!1,this.statusOverride=void 0}).finally(()=>{this.connecting=void 0})),await this.connecting,await this.readying,this.ready||this.closed||this.closing||null==(t=this.raw)||!t.connected||await new Promise(e=>{var t;let r=()=>{this.off("ready",n),this.off("close",n),this.off("end",n)},n=()=>{r(),e()};this.on("ready",n),this.on("close",n),this.on("end",n),(this.ready||this.closed||this.closing||!(null==(t=this.raw)?void 0:t.connected))&&n()})}_closeRaw(){this.reconnectTimer&&(clearTimeout(this.reconnectTimer),this.reconnectTimer=null),this.reconnecting=!1,this.rawFactory=void 0;let e=this.raw;e&&(e.onconnect=()=>{},e.onclose=()=>{},e.onerror=()=>{},e.connected&&setImmediate(()=>{try{e.connected&&e.close()}catch(e){}}))}disconnect(e){if(!this.closed||e)if(e){this.closed=!0,this.statusOverride=void 0;let e=this.raw;e&&(e.onclose=()=>{},e.connected&&setImmediate(()=>{try{e.connected&&e.close()}catch(e){}})),this.emit("close"),this._scheduleReconnect()}else this.closing=!0,this.closed=!0,this.statusOverride="end",this._closeRaw(),this.emit("close"),this.emit("end")}async quit(){return this.closed?setImmediate(()=>{this.emit("end"),this.emit("close")}):(this.closing=!0,this.closed=!0,this.statusOverride="end",this._closeRaw(),setImmediate(()=>{this.emit("end"),this.emit("close")})),"OK"}async _duplicateRaw(e){return"function"==typeof e.duplicate?await e.duplicate():new e.constructor(e.url)}_materializeRaw(){if(this.raw)return Promise.resolve(this.raw);if(this.materializing)return this.materializing;let e=this.rawFactory;if(!e)return Promise.resolve(this.raw);let t=e().then(e=>(this.raw=e,this.rawFactory=void 0,this._setupCallbacks(),e)).finally(()=>{this.materializing===t&&(this.materializing=void 0)});return this.materializing=t,t}async _ensureRaw(){return this.raw||await this.connect(),this.raw}duplicate(...e){let t=new rH(void 0,{rawFactory:async()=>this._duplicateRaw(await this._ensureRaw())});for(let[e,r]of this.scripts)t.scripts.set(e,r),t[e]=(...r)=>t.runCommand(e,r);let r=e[0];return r&&"object"==typeof r&&r.connectionName&&(t.connectionName=r.connectionName),t}defineCommand(e,t){let r=(0,z.createHash)("sha1").update(t.lua).digest("hex");this.scripts.set(e,{sha:r,lua:t.lua,numberOfKeys:t.numberOfKeys}),this[e]=(...t)=>this.runCommand(e,t)}async runCommand(e,t){let r=this.scripts.get(e);if(!r)throw Error(`BullMQ: unknown command "${e}"`);let n=rW(t),{sha:i,lua:a,numberOfKeys:s}=r,o=n.slice(0,s).map(String),l=n.slice(s).map(e=>Buffer.isBuffer(e)?e:null==e?"":String(e)),d=[i,String(o.length),...o,...l];return(async()=>{var e,t;try{let e=await this.sendCommand("EVALSHA",d);return this.loadedScriptShas.add(i),e}catch(r){if(null==(t=null==(e=null==r?void 0:r.message)?void 0:e.includes)?void 0:t.call(e,"NOSCRIPT")){let e=[a,String(o.length),...o,...l],t=await this.sendCommand("EVAL",e);return this.loadedScriptShas.add(i),t}throw r}})()}async ensureScriptsLoaded(e){let t=[],r=new Set;for(let n of e)this.loadedScriptShas.has(n.sha)||r.has(n.sha)||(r.add(n.sha),t.push(n));0!==t.length&&await Promise.all(t.map(async e=>{await this.sendCommand("SCRIPT",["LOAD",e.lua]),this.loadedScriptShas.add(e.sha)}))}sendCommand(e,t){return this.closing||this.closed?Promise.reject(new B("Connection is closed")):this.raw?this.raw.send(e,t).catch(e=>{var t;let r;if("Socket closed unexpectedly"===(r=null!=(t=null==e?void 0:e.message)?t:"")||r.startsWith("Connection closed")||"Connection is closed."===r||"Connection has failed"===r)return this.closing||this.closed?null:Promise.reject(new B(e.message,e));throw e}):this.connect().then(()=>this.sendCommand(e,t))}multi(){return new rB(this.scripts,!0,this)}pipeline(){return new rB(this.scripts,!1,this)}async hgetall(e){let t=await this.sendCommand("HGETALL",[e]);if(!t||Array.isArray(t)&&0===t.length)return{};if(Array.isArray(t)){let e={};for(let r=0;r<t.length;r+=2)e[String(t[r])]=String(t[r+1]);return e}return t}async hget(e,t){let r=await this.sendCommand("HGET",[e,t]);return null!=r?r:null}async hmget(e,...t){return(await this.sendCommand("HMGET",[e,...t])||[]).map(e=>null!=e?e:null)}async hset(e,t,...r){let n;if("object"==typeof t)for(let[r,i]of(n=[e],Object.entries(t)))n.push(r,String(i));else{n=[e,t,String(r[0])];for(let e=1;e<r.length;e+=2)n.push(String(r[e]),String(r[e+1]))}return await this.sendCommand("HSET",n)}async hdel(e,...t){return await this.sendCommand("HDEL",[e,...t])}async hexists(e,t){let r=await this.sendCommand("HEXISTS",[e,t]);return+(!0===r||1===r)}async get(e){let t=await this.sendCommand("GET",[e]);return null!=t?t:null}async set(e,t,r){let n=[e,String(t)];return(null==r?void 0:r.PX)!=null?n.push("PX",String(r.PX)):(null==r?void 0:r.EX)!=null&&n.push("EX",String(r.EX)),await this.sendCommand("SET",n)}async del(...e){return 0===e.length?0:await this.sendCommand("DEL",e)}async zrange(e,t,r,n){let i=[e,String(t),String(r)];(null==n?void 0:n.WITHSCORES)&&i.push("WITHSCORES");let a=await this.sendCommand("ZRANGE",i);return a?(null==n?void 0:n.WITHSCORES)&&a.length>0&&Array.isArray(a[0])?a.flatMap(e=>[String(e[0]),String(e[1])]):a.map(String):[]}async zrevrange(e,t,r,n){let i=[e,String(t),String(r)];(null==n?void 0:n.WITHSCORES)&&i.push("WITHSCORES"),i.push("REV");let a=await this.sendCommand("ZRANGE",i);return a?(null==n?void 0:n.WITHSCORES)&&a.length>0&&Array.isArray(a[0])?a.flatMap(e=>[String(e[0]),String(e[1])]):a.map(String):[]}async zcard(e){return await this.sendCommand("ZCARD",[e])}async zscore(e,t){let r=await this.sendCommand("ZSCORE",[e,t]);return null!=r?String(r):null}async lrange(e,t,r){return(await this.sendCommand("LRANGE",[e,String(t),String(r)])||[]).map(String)}async llen(e){return await this.sendCommand("LLEN",[e])}async ltrim(e,t,r){return await this.sendCommand("LTRIM",[e,String(t),String(r)]),"OK"}async lpos(e,t){let r=await this.sendCommand("LPOS",[e,t]);return null!=r?r:null}async smembers(e){return rU(await this.sendCommand("SMEMBERS",[e]))}async xadd(e,t,r,n){let i=[e];for(let[e,a]of((null==n?void 0:n.MAXLEN)!=null&&(i.push("MAXLEN"),!1!==n.approximate&&i.push("~"),i.push(String(n.MAXLEN))),i.push(t),Object.entries(r)))i.push(e,String(a));return await (await this._ensureRaw()).send("XADD",i)}async xread(e,t){let r,n=[];for(let r of((null==t?void 0:t.COUNT)!=null&&n.push("COUNT",String(t.COUNT)),(null==t?void 0:t.BLOCK)!=null&&n.push("BLOCK",String(t.BLOCK)),n.push("STREAMS"),e))n.push(r.key);for(let t of e)n.push(t.id);try{r=await this.sendCommand("XREAD",n)}catch(e){if(this.closing)return null;throw e}return r?Array.isArray(r)?r.map(e=>[String(e[0]),(e[1]||[]).map(e=>[String(e[0]),(e[1]||[]).map(String)])]):Object.entries(r).map(([e,t])=>[e,(t||[]).map(e=>[String(e[0]),(e[1]||[]).map(String)])]):null}async xtrim(e,t,r,n){let i=[e,t];return(null==n?void 0:n.approximate)!==!1&&i.push("~"),i.push(String(r)),await this.sendCommand("XTRIM",i)}async bzpopmin(e,t){let r;try{r=await this.sendCommand("BZPOPMIN",[e,String(t)])}catch(e){if(this.closing)return null;throw e}return r&&0!==r.length?[String(r[0]),String(r[1]),String(r[2])]:null}async info(){return await this.sendCommand("INFO",[])}async clientSetName(e){return await this.sendCommand("CLIENT",["SETNAME",e])}async clientList(){return await this.sendCommand("CLIENT",["LIST"])}async scan(e,t){let r=[String(e)];(null==t?void 0:t.MATCH)&&r.push("MATCH",t.MATCH),(null==t?void 0:t.COUNT)&&r.push("COUNT",String(t.COUNT));let n=await this.sendCommand("SCAN",r),i=n[1];return[String(n[0]),Array.isArray(i)?i.map(String):[]]}scanStream(e){let t=this,r="0",n=!1,i=new tM.Readable({objectMode:!0,async read(){if(n&&"0"===r)return void i.push(null);n=!0;try{for(;;){let[n,a]=await t.scan(r,{MATCH:e.match,COUNT:e.count});if(r=n,a.length>0){i.push(a),"0"===r&&i.push(null);return}if("0"===r)return void i.push(null)}}catch(e){i.destroy(e)}}});return i}async keys(e){return(await this.sendCommand("KEYS",[e])||[]).map(String)}async exists(...e){if(0===e.length)return 0;let t=await this.sendCommand("EXISTS",e);return"boolean"==typeof t?+!!t:t}async zadd(e,...t){let r=[e];for(let e=0;e<t.length;e+=2)r.push(String(t[e]),String(t[e+1]));return await this.sendCommand("ZADD",r)}async zrem(e,...t){return await this.sendCommand("ZREM",[e,...t])}async xlen(e){return await this.sendCommand("XLEN",[e])}async xrevrange(e,t,r,...n){let i=[e,t,r];"COUNT"===n[0]&&i.push("COUNT",String(n[1]));let a=await this.sendCommand("XREVRANGE",i);return a?a.map(e=>[String(e[0]),(e[1]||[]).map(String)]):[]}async sadd(e,...t){return await this.sendCommand("SADD",[e,...t.map(String)])}async scard(e){return await this.sendCommand("SCARD",[e])}async lpush(e,...t){return await this.sendCommand("LPUSH",[e,...t])}async rpop(e){let t=await this.sendCommand("RPOP",[e]);return null!=t?t:null}async incr(e){return await this.sendCommand("INCR",[e])}async incrby(e,t){return await this.sendCommand("INCRBY",[e,String(t)])}async flushall(){return await this.sendCommand("FLUSHALL",[])}}class rB{constructor(e,t,r){this.scripts=e,this.transactional=t,this.adapter=r,this.commands=[],this.transformers=[],this.scriptsToLoad=[]}addCommand(e,t,r){this.commands.push({cmd:e,args:t}),this.transformers.push(r||(e=>e))}hgetall(e){return this.addCommand("HGETALL",[e],e=>{if(!e||Array.isArray(e)&&0===e.length)return{};if(Array.isArray(e)){let t={};for(let r=0;r<e.length;r+=2)t[String(e[r])]=String(e[r+1]);return t}return e}),this}hset(e,t){let r=[e];for(let[e,n]of Object.entries(t))r.push(e,String(n));return this.addCommand("HSET",r),this}hscan(e,t,r){let n=[e,String(t)];return(null==r?void 0:r.COUNT)!=null&&n.push("COUNT",String(r.COUNT)),this.addCommand("HSCAN",n,e=>e&&Array.isArray(e)?[String(e[0]),rU(e[1])]:["0",[]]),this}smembers(e){return this.addCommand("SMEMBERS",[e],e=>rU(e)),this}sscan(e,t,r){let n=[e,String(t)];return(null==r?void 0:r.COUNT)!=null&&n.push("COUNT",String(r.COUNT)),this.addCommand("SSCAN",n,e=>e&&Array.isArray(e)?[String(e[0]),rU(e[1])]:["0",[]]),this}zrange(e,t,r){return this.addCommand("ZRANGE",[e,String(t),String(r)],e=>Array.isArray(e)?e.map(String):[]),this}lrange(e,t,r){return this.addCommand("LRANGE",[e,String(t),String(r)],e=>Array.isArray(e)?e.map(String):[]),this}llen(e){return this.addCommand("LLEN",[e]),this}del(...e){return e.length>0&&this.addCommand("DEL",e),this}runCommand(e,t){let r=this.scripts.get(e);if(!r)throw Error(`BullMQ: unknown command "${e}" in transaction`);let n=rW(t),{sha:i,numberOfKeys:a}=r,s=n.slice(0,a).map(String),o=n.slice(a).map(e=>Buffer.isBuffer(e)?e:null==e?"":String(e));return this.scriptsToLoad.push(r),this.addCommand("EVALSHA",[i,String(s.length),...s,...o]),this}async exec(){if(0===this.commands.length)return[];if(this.scriptsToLoad.length>0&&await this.adapter.ensureScriptsLoaded(this.scriptsToLoad),!this.transactional)return(await Promise.allSettled(this.commands.map(({cmd:e,args:t})=>this.adapter.sendCommand(e,t)))).map((e,t)=>{if("rejected"===e.status)return[e.reason,null];let r=this.transformers[t];return[null,r?r(e.value):e.value]});let e=e=>{},t=await this.adapter._ensureRaw();try{for(let{cmd:r,args:n}of(t.send("MULTI",[]).catch(e),this.commands))t.send(r,n).catch(e);let r=await t.send("EXEC",[]);if(!r)return null;return r.map((e,t)=>{if(e instanceof Error)return[e,null];let r=this.transformers[t],n=r?r(e):e;return[null,n]})}catch(e){try{await t.send("DISCARD",[])}catch(e){}throw e}}}e.s(["createBunRedisClient",0,rz],2359);let rZ=Symbol("bullmqClusterReconnectPromise"),rX=Symbol("bullmqClusterPatchedForBlocking"),rQ=Symbol("bullmqClusterOriginalBzpopmin"),r0=Symbol("bullmqClusterWrappedBzpopmin"),r1=Symbol("bullmqClusterPatchRefCount"),r2=Symbol("bullmqClusterClosingRefCount");class r3 extends tz.EventEmitter{constructor(e,t){if(super(),this.extraOptions=t,this.capabilities={canDoubleTimeout:!1,canBlockFor1Ms:!0},this.status="initializing",this.dbType="redis",this.packageVersion=tN,this.disabledBlockingClusterReconnect=!1,this.extraOptions=Object.assign({shared:!1,blocking:!0,skipVersionCheck:!1,skipWaitingForReady:!1,clusterReconnectTimeoutMs:3e4},t),ec(e)){if(this._client=function(e){if(rL(e))return e;let t="function"==typeof e.defineCommand;return!t&&"function"==typeof e.sendCommand&&("isOpen"in e||"isReady"in e)?r_(e):!t&&"function"==typeof e.send&&"connected"in e?rz(e):rP(e)}(e),this._client.options.keyPrefix)throw Error("BullMQ: ioredis does not support ioredis prefixes, use the prefix option instead.");this._client.isCluster?this.opts=this._client.options.redisOptions:this.opts=this._client.options,this.checkBlockingOptions("BullMQ: Your redis options maxRetriesPerRequest must be null.",this.opts,!0)}else this.checkBlockingOptions("BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.",e),this.opts=Object.assign({port:6379,host:"127.0.0.1",retryStrategy:function(e){return Math.max(Math.min(Math.exp(e),2e4),1e3)}},e),this.extraOptions.blocking&&(this.opts.maxRetriesPerRequest=null);this.skipVersionCheck=(null==t?void 0:t.skipVersionCheck)||!!(this.opts&&this.opts.skipVersionCheck),this.handleClientError=e=>{this.emit("error",e)},this.handleClientClose=()=>{this.emit("close")},this.handleClientReady=()=>{this.emit("ready")},this.initializing=this.init(),this.initializing.catch(e=>{this.listenerCount("error")>0&&this.emit("error",e)})}checkBlockingOptions(e,t,r=!1){if(this.extraOptions.blocking&&t&&t.maxRetriesPerRequest)if(r)throw Error(e);else console.error(e)}static async waitUntilReady(e){let t,r,n;if("ready"!==e.status&&!("connect"===e.status&&eu(e))){if("wait"===e.status)return e.connect();if("end"===e.status)throw new B(H);try{await new Promise((i,a)=>{let s;n=e=>{s=e},t=()=>{i()},r=()=>{"end"!==e.status?a(s||new B(H)):s?a(s):i()},es(e,3),e.once("ready",t),e.on("end",r),e.once("error",n)})}finally{e.removeListener("end",r),e.removeListener("error",n),e.removeListener("ready",t),eh(e,3)}}}get client(){return this.initializing}loadCommands(e,t){let r=t||rM;for(let t in r){let n=`${r[t].name}:${e}`;this._client[n]||this._client.defineCommand(n,{numberOfKeys:r[t].keys,lua:r[t].content})}}async init(){if(!this._client)if(r3.clientFactory)this._client=r3.clientFactory(this.opts);else{let t=this.opts,{url:r}=t,n=(0,tU.__rest)(t,["url"]),i=function(){var t;try{{let r=e.r(42512);return null!=(t=r.default)?t:r}}catch(e){}throw Error("BullMQ could not load the optional 'ioredis' package. Install it with `npm install ioredis`, or provide a different Redis client instance (e.g. node-redis) via the connection option. In a native ESM environment, pass an already-constructed client instance instead of connection options.")}(),a=r?new i(r,n):new i(n);this._client=rP(a)}if(es(this._client,3),this._client.on("error",this.handleClientError),this._client.on("close",this.handleClientClose),this._client.on("ready",this.handleClientReady),this.patchBlockingClusterClient(),this.extraOptions.skipWaitingForReady||await r3.waitUntilReady(this._client),this.loadCommands(this.packageVersion),"end"!==this._client.status){let e=await this.getRedisVersionAndType();if(this.version=e.version,this.dbType=e.databaseType,!0!==this.skipVersionCheck&&!this.closing){if(eK(this.version,r3.minimumVersion,this.dbType))throw Error(`Redis version needs to be greater or equal than ${r3.minimumVersion} Current: ${this.version}`);eK(this.version,r3.recommendedMinimumVersion,this.dbType)&&console.warn(`It is highly recommended to use a minimum Redis version of ${r3.recommendedMinimumVersion}
             Current: ${this.version}`)}this.capabilities={canDoubleTimeout:!eK(this.version,"6.0.0",this.dbType),canBlockFor1Ms:!eK(this.version,"7.0.8",this.dbType)},this.status="ready"}return this._client}patchBlockingClusterClient(){var e;let t=this._client;if(!this.extraOptions.blocking||!eu(t)||"function"!=typeof t.bzpopmin)return;let r=null!=(e=this.extraOptions.clusterReconnectTimeoutMs)?e:3e4;if(t[r1]=(t[r1]||0)+1,this.patchedBlockingClusterClient=t,t[rX])return;let n=t.bzpopmin,i=async(...e)=>{await r3.reconnectClusterIfNeeded(t,r);try{return await n.apply(t,e)}catch(e){if(r3.shouldReconnectClusterAfterError(t,e))try{await r3.reconnectCluster(t,r)}catch(e){}throw e}};t[rQ]=n,t[r0]=i,t[rX]=!0,t.bzpopmin=i}disableBlockingClusterReconnect(){let e=this.patchedBlockingClusterClient;e&&!this.disabledBlockingClusterReconnect&&(e[r2]=(e[r2]||0)+1,this.disabledBlockingClusterReconnect=!0)}releaseBlockingClusterClientPatch(){let e=this.patchedBlockingClusterClient;if(!e)return;if(this.disabledBlockingClusterReconnect){let t=(e[r2]||1)-1;t>0?e[r2]=t:delete e[r2],this.disabledBlockingClusterReconnect=!1}let t=(e[r1]||1)-1;if(t>0){e[r1]=t,this.patchedBlockingClusterClient=void 0;return}e[rQ]&&e.bzpopmin===e[r0]&&(e.bzpopmin=e[rQ]),delete e[r1],delete e[r2],delete e[rQ],delete e[r0],delete e[rX],this.patchedBlockingClusterClient=void 0}static isClusterWithEmptyNodes(e){return"function"==typeof e.nodes&&0===e.nodes().length}static isReconnectingDisabled(e){let t=e[r1]||0,r=e[r2]||0;return 0===t||r>=t||"end"===e.status||"closing"===e.status}static async reconnectClusterIfNeeded(e,t){!r3.isReconnectingDisabled(e)&&r3.isClusterWithEmptyNodes(e)&&await r3.reconnectCluster(e,t)}static shouldReconnectClusterAfterError(e,t){var r,n;if(r3.isReconnectingDisabled(e))return!1;let i=[t.message,null==(r=t.cause)?void 0:r.message,null==(n=t.lastNodeError)?void 0:n.message].join(" ");return r3.isClusterWithEmptyNodes(e)||/Command timed out|Failed to refresh slots cache/i.test(i)}static async reconnectCluster(e,t){r3.isReconnectingDisabled(e)||(e[rZ]||(e[rZ]=r3.connectClusterWithTimeout(e,t).finally(()=>{e[rZ]=null})),await e[rZ])}static async connectClusterWithTimeout(e,t){let r;e.disconnect(!1);try{await Promise.race([e.connect(),new Promise((e,n)=>{var i;null==(i=(r=setTimeout(()=>{n(new B(`BullMQ: cluster reconnect timed out after ${t}ms`))},t)).unref)||i.call(r)})])}finally{r&&clearTimeout(r)}}async disconnect(e=!0){let t=await this.client;if("end"!==t.status){let r,n;if(!e)return t.disconnect();let i=new Promise((e,i)=>{es(t,2),t.once("end",e),t.once("error",i),r=e,n=i});t.disconnect();try{await i}finally{eh(t,2),t.removeListener("end",r),t.removeListener("error",n)}}}async reconnect(){let e=await this.client;for(;;){if("ready"===e.status||"connect"===e.status&&eu(e))return;if("wait"===e.status||"end"===e.status)return e.connect();try{await r3.waitUntilReady(e)}catch(t){if(!["end","connecting","connect","reconnecting"].includes(e.status))throw t}}}async close(e=!1){var t;if(!this.closing){let r=this.status;this.status="closing",this.closing=!0,this.disableBlockingClusterReconnect();try{"ready"===r&&await this.initializing,this.extraOptions.shared||("initializing"==r||e?(this._client.disconnect(),null==(t=this.initializing)||t.catch(()=>{})):await this._client.quit(),this._client.status="end")}catch(e){if(ef(e))throw e}finally{this.releaseBlockingClusterClientPatch(),this._client.off("error",this.handleClientError),this._client.off("close",this.handleClientClose),this._client.off("ready",this.handleClientReady),eh(this._client,3),this.removeAllListeners(),this.status="closed"}}}async getRedisVersionAndType(){let e;if(this.skipVersionCheck)return{version:r3.minimumVersion,databaseType:"redis"};let t=await this._client.info(),r="redis_version:",n="maxmemory_policy:",i=t.split(/\r?\n/),a="redis";for(let t=0;t<i.length;t++){let s=i[t];if(s.includes("dragonfly_version:")||s.includes("server:Dragonfly")?(a="dragonfly",0===s.indexOf("dragonfly_version:")&&(e=s.substr(18))):s.includes("valkey_version:")||s.includes("server:Valkey")?(a="valkey",0===s.indexOf("valkey_version:")&&(e=s.substr(15))):0===s.indexOf(r)&&(e=s.substr(r.length),"redis"===a&&(a="redis")),0===s.indexOf(n)){let e=s.substr(n.length);"noeviction"!==e&&console.warn(`IMPORTANT! Eviction policy is ${e}. It should be "noeviction"`)}}if(!e){for(let t of i)if(t.includes("version:")){let r=t.split(":");if(r.length>=2){e=r[1];break}}}return{version:e||r3.minimumVersion,databaseType:a}}get redisVersion(){return this.version}get databaseType(){return this.dbType}}r3.minimumVersion="5.0.0",r3.recommendedMinimumVersion="6.2.0",e.s(["RedisConnection",0,r3],49273);let r4=(e,t,{blocking:r=!1,withBlockingConnection:n=!1}={})=>{var i;let a,s,o,l=new r3(t.connection,{shared:ec(t.connection),blocking:r,skipVersionCheck:t.skipVersionCheck,skipWaitingForReady:t.skipWaitingForReady}),d=n?(a=Buffer.from(e).toString("base64"),s=t.name,o=`${null!=(i=t.prefix)?i:"bull"}:${a}${s?`:w:${s}`:""}`,new r3(ec(t.connection)?(rL(t.connection)?t.connection:rP(t.connection)).duplicate({connectionName:o}):Object.assign(Object.assign({},t.connection),{connectionName:o}),{shared:!1,blocking:!0,skipVersionCheck:t.skipVersionCheck})):void 0,c=new tq(t.prefix),u=c.getKeys(e);return new tG(l,e,u,t=>c.toKey(e,t),t,d)},r6=r4;function r5(){return r6}e.s(["createRedisBackend",0,r4,"getDefaultBackendFactory",0,r5,"setDefaultBackendFactory",0,function(e){r6=null!=e?e:r4}],26460);let r8=(0,e.i(24361).debuglog)("bull");class r9{constructor(e,t,r,n={},i){var a;this.queue=e,this.name=t,this.data=r,this.opts=n,this.id=i,this.progress=0,this.returnvalue=null,this.stacktrace=null,this.delay=0,this.priority=0,this.attemptsStarted=0,this.attemptsMade=0,this.stalledCounter=0;const s=this.opts,{repeatJobKey:o}=s,l=(0,tU.__rest)(s,["repeatJobKey"]);this.opts=Object.assign({attempts:0},l),this.delay=this.opts.delay,this.priority=this.opts.priority||0,this.repeatJobKey=o,this.timestamp=n.timestamp?n.timestamp:Date.now(),this.opts.backoff=d.normalize(n.backoff),this.parentKey=em(n.parent),n.parent&&(this.parent={id:n.parent.id,queueKey:n.parent.queue},n.failParentOnFailure&&(this.parent.fpof=!0),n.removeDependencyOnFailure&&(this.parent.rdof=!0),n.ignoreDependencyOnFailure&&(this.parent.idof=!0),n.continueParentOnFailure&&(this.parent.cpof=!0)),this.deduplicationId=null==(a=this.opts.deduplication)?void 0:a.id,this.toKey=e.toKey.bind(e),this.createBackend(),this.queueQualifiedName=e.qualifiedName}static async create(e,t,r,n){let i=new this(e,t,r,n,n&&n.jobId),a=i.asJSON();return i.validateOptions(a),i.id=await i.backend.addJob(a,i.id,{parentKey:i.parentKey,parentDependenciesKey:i.parentKey?`${i.parentKey}:dependencies`:""}),i}static async createBulk(e,t){let r=t.map(t=>{var r;return new this(e,t.name,t.data,t.opts,null==(r=t.opts)?void 0:r.jobId)}),n=e.backend,i=r.map(e=>{let t=e.asJSON();return e.validateOptions(t),{job:t,jobId:e.id,parentKeyOpts:{parentKey:e.parentKey,parentDependenciesKey:e.parentKey?`${e.parentKey}:dependencies`:""}}}),a=await n.addJobs(i);return r.forEach((e,t)=>{e.id=a[t]}),r}static fromJSON(e,t,r){var n,i,a,s;let o=JSON.parse(t.data||"{}"),l=new this(e,t.name,o,t.opts,t.id||r);return l.progress=null!=(n=t.progress)?n:0,l.delay=t.delay,l.priority=t.priority,l.timestamp=t.timestamp,t.finishedOn&&(l.finishedOn=t.finishedOn),t.processedOn&&(l.processedOn=t.processedOn),t.repeatJobKey&&(l.repeatJobKey=t.repeatJobKey),t.deduplicationId&&(l.deduplicationId=t.deduplicationId),t.failedReason&&(l.failedReason=t.failedReason),l.attemptsStarted=null!=(i=t.attemptsStarted)?i:0,l.attemptsMade=null!=(a=t.attemptsMade)?a:0,l.stalledCounter=null!=(s=t.stalledCounter)?s:0,t.deferredFailure&&(l.deferredFailure=t.deferredFailure),l.stacktrace=function(e){if(!e)return[];let t=Q(JSON.parse,JSON,[e]);return t!==X&&t instanceof Array?t:[]}(t.stacktrace),"string"==typeof t.returnvalue&&(l.returnvalue=r7(t.returnvalue)),t.parentKey?l.parentKey=t.parentKey:l.parentKey=void 0,t.parent?l.parent=t.parent:l.parent=void 0,t.processedBy&&(l.processedBy=t.processedBy),l}createBackend(){this.backend=this.queue.backend}static optsFromJSON(e,t=el){let r=Object.entries(JSON.parse(e||"{}")),n={};for(let e of r){let[r,i]=e;t[r]?n[t[r]]=i:"tm"===r?n.telemetry=Object.assign(Object.assign({},n.telemetry),{metadata:i}):"omc"===r?n.telemetry=Object.assign(Object.assign({},n.telemetry),{omitContext:i}):n[r]=i}return n}static async fromId(e,t){if(t){let r=e.backend,n=await r.getJobData(t);return n?this.fromJSON(e,n,t):void 0}}static addJobLog(e,t,r,n){return e.backend.addLog(t,r,n)}toJSON(){let{queue:e,backend:t}=this;return(0,tU.__rest)(this,["queue","backend"])}asJSON(){return eS({id:this.id,name:this.name,data:JSON.stringify(void 0===this.data?{}:this.data),opts:this.opts,parent:this.parent?Object.assign({},this.parent):void 0,parentKey:this.parentKey,progress:this.progress,attemptsMade:this.attemptsMade,attemptsStarted:this.attemptsStarted,stalledCounter:this.stalledCounter,finishedOn:this.finishedOn,processedOn:this.processedOn,timestamp:this.timestamp,failedReason:JSON.stringify(this.failedReason),stacktrace:JSON.stringify(this.stacktrace),deduplicationId:this.deduplicationId,repeatJobKey:this.repeatJobKey,returnvalue:JSON.stringify(this.returnvalue)})}asJSONSandbox(){return Object.assign(Object.assign({},this.asJSON()),{queueName:this.queueName,queueQualifiedName:this.queueQualifiedName,prefix:this.prefix})}updateData(e){return this.data=e,this.backend.updateData(this,e)}async updateProgress(e){this.progress=e,await this.backend.updateProgress(this.id,e),this.queue.emit("progress",this,e)}async log(e){return r9.addJobLog(this.queue,this.id,e,this.opts.keepLogs)}async removeChildDependency(){return!!await this.backend.removeChildDependency(this.id,this.parentKey)&&(this.parent=void 0,this.parentKey=void 0,!0)}async clearLogs(e){await this.backend.clearLogs(this.id,e)}async remove({removeChildren:e=!0}={}){await this.queue.waitUntilReady();let t=this.queue;if(await this.backend.remove(this.id,e))t.emit("removed",this);else throw Error(`Job ${this.id} could not be removed because it is locked by another worker`)}async removeUnprocessedChildren(){let e=this.id;await this.backend.removeUnprocessedChildren(e)}extendLock(e,t){return this.backend.extendLock(this.id,e,t)}async moveToCompleted(e,t,r=!0){return this.queue.trace(k.INTERNAL,"complete",this.queue.name,async n=>{if(this.setSpanJobAttributes(n),await this.queue.waitUntilReady(),this.returnvalue=e||void 0,Q(JSON.stringify,JSON,[e])===X)throw X.value;let{result:i,finishedOn:a}=await this.backend.moveToCompleted(this,e,this.opts.removeOnComplete,t,r);return this.finishedOn=a,this.attemptsMade+=1,this.recordJobMetrics("completed"),i})}async moveToWait(e){let t=await this.backend.moveJobFromActiveToWait(this.id,e);return this.recordJobMetrics("waiting"),t}async shouldRetryJob(e){if(!(this.attemptsMade+1<this.opts.attempts)||e instanceof tJ||"UnrecoverableError"==e.name)return[!1,0];{let t=this.queue.opts,r=await d.calculate(this.opts.backoff,this.attemptsMade+1,e,this,t.settings&&t.settings.backoffStrategy);return[-1!=r,-1==r?0:r]}}async moveToFailed(e,t,r=!1){this.failedReason=null==e?void 0:e.message;let[n,i]=await this.shouldRetryJob(e);return this.queue.trace(k.INTERNAL,this.getSpanOperation(n,i),this.queue.name,async(a,s)=>{var o,l;let d,c,u;this.setSpanJobAttributes(a),(null==(l=null==(o=this.opts)?void 0:o.telemetry)?void 0:l.omitContext)||!s||(d=s),this.updateStacktrace(e);let h={failedReason:this.failedReason,stacktrace:JSON.stringify(this.stacktrace),tm:d};if(n)i?(c=await this.backend.moveToDelayed(this.id,Date.now(),i,t,{fieldsToUpdate:h,fetchNext:r}),this.recordJobMetrics("delayed")):(c=await this.backend.retryJob(this.id,this.opts.lifo,t,{fieldsToUpdate:h}),this.recordJobMetrics("retried"));else{let e=await this.backend.moveToFailed(this,this.failedReason,this.opts.removeOnFail,t,r,h);c=e.result,u=e.finishedOn,this.recordJobMetrics("failed")}return u&&"number"==typeof u&&(this.finishedOn=u),i&&"number"==typeof i&&(this.delay=i),this.attemptsMade+=1,c})}getSpanOperation(e,t){return e?t?"delay":"retry":"fail"}recordJobMetrics(e){var t,r;let n=null==(r=null==(t=this.queue.opts)?void 0:t.telemetry)?void 0:r.meter;if(!n)return;let i={[w.QueueName]:this.queue.name,[w.JobName]:this.name,[w.JobState]:e},a={completed:S.JobsCompleted,failed:S.JobsFailed,delayed:S.JobsDelayed,retried:S.JobsRetried,waiting:S.JobsWaiting,"waiting-children":S.JobsWaitingChildren}[e];if(n.createCounter(a,{description:`Number of jobs ${e}`,unit:"1"}).add(1,i),this.processedOn){let e=Date.now()-this.processedOn;n.createHistogram(S.JobDuration,{description:"Job processing duration",unit:"ms"}).record(e,i)}}isCompleted(){return this.isInState("completed")}isFailed(){return this.isInState("failed")}isDelayed(){return this.isInState("delayed")}isWaitingChildren(){return this.isInState("waiting-children")}isActive(){return this.isInState("active")}async isWaiting(){return this.isInState("waiting")}get queueName(){return this.queue.name}get prefix(){let e=this.queueQualifiedName,t=this.queueName;return e.length>t.length+1?e.slice(0,e.length-t.length-1):""}getState(){return this.backend.getState(this.id)}async changeDelay(e){await this.backend.changeDelay(this.id,e),this.delay=e}async changePriority(e){await this.backend.changePriority(this.id,e.priority,e.lifo),this.priority=e.priority||0}async getChildrenValues(){let e=await this.backend.getProcessedChildrenValues(this.id);if(e)return ev(e)}async getIgnoredChildrenFailures(){return this.backend.getIgnoredChildrenFailures(this.id)}async getFailedChildrenValues(){return this.backend.getIgnoredChildrenFailures(this.id)}async getDependencies(e={}){return this.backend.getDependencies(this.id,e)}async getDependenciesCount(e={}){let t=[];Object.entries(e).forEach(([e,r])=>{r&&t.push(e)});let r=t.length?t:["processed","unprocessed","ignored","failed"],n=await this.backend.getDependencyCounts(this.id,r),i={};return n.forEach((e,t)=>{i[`${r[t]}`]=e||0}),i}async waitUntilFinished(e,t){await this.queue.waitUntilReady();let r=this.id;return new Promise(async(n,i)=>{let a;function s(e){c(),n(e.returnvalue)}function o(e){c(),i(Error(e.failedReason||e))}t&&(a=setTimeout(()=>o(`Job wait ${this.name} timed out before finishing, no finish notification arrived after ${t}ms (id=${r})`),t));let l=`completed:${r}`,d=`failed:${r}`;e.on(l,s),e.on(d,o),this.queue.on("closing",o);let c=()=>{clearInterval(a),e.removeListener(l,s),e.removeListener(d,o),this.queue.removeListener("closing",o)};await e.waitUntilReady();let[u,h]=await this.backend.isFinished(r,!0);0!=u&&(-1==u||2==u?o({failedReason:h}):s({returnvalue:r7(h)}))})}async moveToDelayed(e,t){let r=Date.now(),n=e-r,i=n>0?n:0;await this.backend.moveToDelayed(this.id,r,i,t,{skipAttempt:!0}),this.delay=i,this.recordJobMetrics("delayed")}async moveToWaitingChildren(e,t={}){let r=await this.backend.moveToWaitingChildren(this.id,e,t);return r&&this.recordJobMetrics("waiting-children"),r}async promote(){let e=this.id;await this.backend.promote(e),this.delay=0}async retry(e="failed",t={}){await this.backend.retryFinishedJob(this,e,t),this.failedReason=null,this.finishedOn=null,this.processedOn=null,this.returnvalue=null,t.resetAttemptsMade&&(this.attemptsMade=0),t.resetAttemptsStarted&&(this.attemptsStarted=0)}async isInState(e){return this.backend.isJobInState(e,this.id)}addJob(e,t){let r=this.asJSON();return this.validateOptions(r),this.backend.addJobToTransaction(e,r,this.id,t)}toFlowEntry(e={}){let t=this.asJSON();return this.validateOptions(t),{jobData:t,jobId:this.id,parentKeyOpts:e,prefix:this.prefix,queueName:this.queueName}}async removeDeduplicationKey(){return!!this.deduplicationId&&await this.backend.removeDeduplicationKey(this.deduplicationId,this.id)>0}validateOptions(e){var t,r,n,i,a,s;if(this.opts.sizeLimit&&ee(e.data)>this.opts.sizeLimit)throw Error(`The size of job ${this.name} exceeds the limit ${this.opts.sizeLimit} bytes`);let o=["removeDependencyOnFailure","failParentOnFailure","continueParentOnFailure","ignoreDependencyOnFailure"].filter(e=>this.opts[e]);if(o.length>1){let e=o.join(", ");throw Error(`The following options cannot be used together: ${e}`)}if(null==(t=this.opts)?void 0:t.jobId){if(`${parseInt(this.opts.jobId,10)}`===(null==(r=this.opts)?void 0:r.jobId))throw Error("Custom Id cannot be integers");if((null==(n=this.opts)?void 0:n.jobId.includes(":"))&&(null==(a=null==(i=this.opts)?void 0:i.jobId)?void 0:a.split(":").length)!==3)throw Error("Custom Id cannot contain :")}if(this.opts.priority){if(Math.trunc(this.opts.priority)!==this.opts.priority)throw Error("Priority should not be float");if(this.opts.priority>2097151)throw Error("Priority should be between 0 and 2097151")}if(this.opts.deduplication){if(!(null==(s=this.opts.deduplication)?void 0:s.id))throw Error("Deduplication id must be provided");if(this.parentKey)throw Error("Deduplication and parent options cannot be used together")}if(Object.prototype.hasOwnProperty.call(this.opts,"debounce"))throw Error("Debounce option has been removed. Use deduplication option instead");if("object"==typeof this.opts.backoff&&"number"==typeof this.opts.backoff.jitter&&(this.opts.backoff.jitter<0||this.opts.backoff.jitter>1))throw Error("Jitter should be between 0 and 1")}updateStacktrace(e){this.stacktrace=this.stacktrace||[],(null==e?void 0:e.stack)&&(this.stacktrace.push(e.stack),0===this.opts.stackTraceLimit?this.stacktrace=[]:this.opts.stackTraceLimit&&(this.stacktrace=this.stacktrace.slice(-this.opts.stackTraceLimit)))}setSpanJobAttributes(e){null==e||e.setAttributes({[w.JobName]:this.name,[w.JobId]:this.id})}}function r7(e){let t=Q(JSON.parse,JSON,[e]);if(t!==X)return t;r8("corrupted returnvalue: "+e,t)}e.s(["Job",0,r9,"PRIORITY_LIMIT",0,2097151],81652);class ne extends eD.EventEmitter{constructor(e={connection:{}},t=r5()){super(),this.opts=e,this.opts=Object.assign({},e),this.backend=t("",this.opts),this.backend.on("error",e=>{this.listenerCount("error")>0&&this.emit("error",e)}),this.backend.on("close",()=>{this.closing||this.emit("ioredis:close")}),(null==e?void 0:e.telemetry)&&(this.telemetry=e.telemetry)}emit(e,...t){return super.emit(e,...t)}off(e,t){return super.off(e,t),this}on(e,t){return super.on(e,t),this}once(e,t){return super.once(e,t),this}get Job(){return r9}waitUntilReady(){return this.backend.waitUntilReady()}getBackend(){return this.backend}async add(e,t){if(this.closing)return;this.validateFlowJobs([e]),await this.backend.waitUntilReady();let r=null==e?void 0:e.opts,n=r&&"parent"in r?r.parent:void 0,i=em(n),a=i?`${i}:dependencies`:void 0;return ek(this.telemetry,k.PRODUCER,e.queueName,"addFlow",e.queueName,async r=>{null==r||r.setAttributes({[w.FlowName]:e.name});let s=[],o=await this.addNode({entries:s,node:e,queuesOpts:null==t?void 0:t.queuesOptions,parent:{parentOpts:n,parentDependenciesKey:a}}),[l]=await this.backend.addFlow(s)||[];if(l){let[e,t]=l;if(e)throw e;if("number"==typeof t&&t<0)throw this.toFlowError(t,i);"string"==typeof t&&(o.job.id=t)}return o})}async getFlow(e){if(this.closing)return;await this.backend.waitUntilReady();let t=Object.assign({depth:10,maxChildren:20,prefix:this.opts.prefix},e);return this.getNode(t)}async addBulk(e){if(!this.closing)return this.validateFlowJobs(e),await this.backend.waitUntilReady(),ek(this.telemetry,k.PRODUCER,"","addBulkFlows","",async t=>{null==t||t.setAttributes({[w.BulkCount]:e.length,[w.BulkNames]:e.map(e=>e.name).join(",")});let r=[],n=await this.addNodes(r,e),i=await this.backend.addFlow(r);for(let e=0;e<n.length;++e){let t=null==i?void 0:i[e];if(!t)continue;let[r,a]=t;r||"string"!=typeof a||(n[e].job.id=a)}return n})}async addNode({entries:e,node:t,parent:r,queuesOpts:n}){var i,a;let s=t.prefix||this.opts.prefix,o=this.queueFromNode(t,s),l=n&&n[t.queueName],d=null!=(i=null==l?void 0:l.defaultJobOptions)?i:{},c=(null==(a=t.opts)?void 0:a.jobId)||(0,z.randomUUID)();return ek(this.telemetry,k.PRODUCER,t.queueName,"addNode",t.queueName,async(i,a)=>{var s,l;null==i||i.setAttributes({[w.JobName]:t.name,[w.JobId]:c});let u=t.opts,h=null==u?void 0:u.telemetry;if(a&&u){let e=null==(s=u.telemetry)?void 0:s.omitContext,t=(null==(l=u.telemetry)?void 0:l.metadata)||!e&&a;(t||e)&&(h={metadata:t,omitContext:e})}let p=new this.Job(o,t.name,t.data,Object.assign(Object.assign(Object.assign({},d),u),{parent:null==r?void 0:r.parentOpts,telemetry:h}),c),m=em(null==r?void 0:r.parentOpts);if(!t.children||!(t.children.length>0))return await this.collectFlowEntry(e,p,{parentDependenciesKey:null==r?void 0:r.parentDependenciesKey,parentKey:m}),{job:p};{await this.collectFlowEntry(e,p,{parentDependenciesKey:null==r?void 0:r.parentDependenciesKey,addToWaitingChildren:!0,parentKey:m});let i=`${o.toKey(c)}:dependencies`;return{job:p,children:await this.addChildren({entries:e,nodes:t.children,parent:{parentOpts:{id:c,queue:o.qualifiedName},parentDependenciesKey:i},queuesOpts:n})}}})}async collectFlowEntry(e,t,r){e.push(t.toFlowEntry(r))}addNodes(e,t){return Promise.all(t.map(t=>{let r=null==t?void 0:t.opts,n=r&&"parent"in r?r.parent:void 0,i=em(n),a=i?`${i}:dependencies`:void 0;return this.addNode({entries:e,node:t,parent:{parentOpts:n,parentDependenciesKey:a}})}))}async getNode(e){let t=this.queueFromNode(e,e.prefix),r=await this.Job.fromId(t,e.id);if(r){let{processed:t={},unprocessed:n=[],failed:i=[],ignored:a={}}=await r.getDependencies({failed:{count:e.maxChildren},processed:{count:e.maxChildren},unprocessed:{count:e.maxChildren},ignored:{count:e.maxChildren}}),s=Object.keys(t),o=Object.keys(a),l=s.length+n.length+o.length+i.length,d=e.depth-1;return l>0&&d?{job:r,children:await this.getChildren([...s,...n,...i,...o],d,e.maxChildren)}:{job:r}}}validateFlowJobs(e){for(let t of e){let e=t.children;if(e&&e.length>0){let r=t.opts;if(r&&"deduplication"in r&&r.deduplication)throw Error("Deduplication options cannot be used on flow nodes with children");this.validateFlowJobs(e)}}}addChildren({entries:e,nodes:t,parent:r,queuesOpts:n}){return Promise.all(t.map(t=>this.addNode({entries:e,node:t,parent:r,queuesOpts:n})))}getChildren(e,t,r){let n=e=>{let{prefix:n,queueName:i,id:a}=this.backend.parseNodeKey(e);return this.getNode({id:a,queueName:i,prefix:n,depth:t,maxChildren:r})};return Promise.all([...e.map(n)])}queueFromNode(e,t){let r=this.backend.forQueue(e.queueName,t);return{name:e.queueName,keys:r.keys,toKey:e=>r.toKey(e),opts:{prefix:t,connection:{}},qualifiedName:r.qualifiedName,closing:this.closing,backend:r,waitUntilReady:async()=>{await this.backend.waitUntilReady()},removeListener:this.removeListener.bind(this),emit:this.emit.bind(this),on:this.on.bind(this),trace:async()=>{}}}toFlowError(e,t){let r;switch(e){case v.ParentJobNotExist:r=Error(`Missing key for parent job ${t}. addJob`);break;case v.ParentJobCannotBeReplaced:r=Error(`The parent job ${t} cannot be replaced. addJob`);break;default:r=Error(`Unknown code ${e} error for addJob`)}return r.code=e,r}async close(){this.closing||(this.closing=this.backend.close()),await this.closing}disconnect(){return this.backend.disconnect()}}e.s(["FlowProducer",0,ne],46124);var nt=q;function nr(e){return Buffer.isBuffer(e)}function nn(e){return nr(e)?e:null==e?"":String(e)}function ni(e){return nr(e)?e.toString():String(e)}function na(e){return Array.isArray(e)&&e.every(e=>e&&"object"==typeof e&&"key"in e&&"value"in e)}function ns(e){return 1===e.length&&Array.isArray(e[0])?e[0]:e}function no(e){if(!e)return{};if(na(e))return e.reduce((e,t)=>(e[ni(t.key)]=ni(t.value),e),{});if(e instanceof Map){let t={};for(let[r,n]of e.entries())t[ni(r)]=ni(n);return t}if(Array.isArray(e)){let t={};for(let r=0;r<e.length;r+=2)t[ni(e[r])]=ni(e[r+1]);return t}if("object"==typeof e){let t={};for(let[r,n]of Object.entries(e))t[r]=ni(n);return t}return{}}function nl(e){return e?Array.isArray(e)?na(e)?e.flatMap(e=>[ni(e.key),ni(e.value)]):e.every(e=>Array.isArray(e)&&2===e.length)?e.flatMap(e=>{let[t,r]=e;return[ni(t),ni(r)]}):e.map(e=>ni(e)):"object"==typeof e?Object.entries(e).flatMap(([e,t])=>[e,ni(t)]):[]:[]}function nd(e,t=!1){return Array.isArray(e)?t?na(e)?e.flatMap(e=>[ni(e.key),ni(e.value)]):e.every(e=>Array.isArray(e)&&e.length>=2&&void 0!==e[0])?e.flatMap(e=>[ni(e[0]),ni(e[1])]):e.map(e=>ni(e)):e.map(e=>ni(e)):[]}function nc(e){return new nu(e)}class nu extends nt.EventEmitter{constructor(e,t){super(),this.connectionName=t,this.scripts=new Map,this.scriptsBySha=new Map,this.scriptLoadPromises=new Map,this.readyEmitted=!1,this.closed=!1,this.operationChain=Promise.resolve(),this.activeBlockingCommands=0,e instanceof Promise?(this.rawPromise=e,this.connect().catch(e=>this.emit("error",e))):this.raw=e}get status(){return this.statusOverride?this.statusOverride:this.closed?"end":this.readyEmitted?"ready":"wait"}set status(e){"end"===e&&this.disconnect(),this.statusOverride=e}get isCluster(){var e,t,r;return(null!=(r=null==(t=null==(e=this.raw)?void 0:e.constructor)?void 0:t.name)?r:"").includes("Cluster")}get options(){var e,t,r,n;return null!=(n=null!=(t=null==(e=this.raw)?void 0:e.config)?t:null==(r=this.raw)?void 0:r.options)?n:{}}set options(e){}ensureOpen(){if(this.closed)throw new B}normalizeError(e){if(e instanceof B||e instanceof Error&&"ClosingError"===e.name)throw new B(e.message,e);throw e}async ensureRaw(){if(this.raw)return this.raw;if(!this.rawPromise)throw Error("BullMQ: Valkey Glide client not initialized - missing raw client and client promise. Please report this as a bug.");return this.raw=await this.rawPromise,this.raw}async runSerialized(e){let t;this.ensureOpen();let r=this.operationChain;this.operationChain=new Promise(e=>{t=e}),await r,this.ensureOpen();try{let t=await this.ensureRaw();return this.ensureOpen(),await e(t)}catch(e){this.normalizeError(e)}finally{t()}}async runRawCommand(e,t){let r=function(e){let[t,...r]=e,n=ni(t).toUpperCase();if("BZPOPMIN"===n)return!0;if("XREAD"!==n)return!1;for(let e=0;e<r.length;e+=2)if("BLOCK"===ni(r[e]).toUpperCase())return!0;return!1}(e);return this.runSerialized(async n=>{r&&this.activeBlockingCommands++;try{return await n.customCommand(e,t)}finally{r&&this.activeBlockingCommands--}})}ensureScriptLoaded(e){let t=this.scriptLoadPromises.get(e.sha);return t||(t=this.runRawCommand(["SCRIPT","LOAD",e.lua]).then(()=>{}).catch(()=>{}),this.scriptLoadPromises.set(e.sha,t)),t}async applyConnectionNameIfNeeded(){this.connectionName&&await this.runRawCommand(["CLIENT","SETNAME",this.connectionName],{decoder:1})}async clearConnectionNameIfNeeded(e){if(this.connectionName)try{await e.customCommand(["CLIENT","SETNAME",""],{decoder:1})}catch(e){}}async recreateRaw(){var e,t;let r=await this.ensureRaw(),n=r.constructor,i=null==(e=null==n?void 0:n.createClient)?void 0:e.bind(n),a=null!=(t=r.config)?t:r.options;if(!i||!a)throw Error("BullMQ: Cannot recreate Valkey Glide client: missing createClient() method or config object. Ensure the client was created via GlideClient.createClient() or GlideClusterClient.createClient().");this.raw=await i(a),this.scriptLoadPromises.clear()}async connect(){return this.connecting||(this.connecting=(async()=>{this.closed&&this.raw&&await this.recreateRaw(),this.closed=!1,this.statusOverride=void 0,await this.ensureRaw();try{await this.applyConnectionNameIfNeeded()}catch(e){if(this.closed&&e instanceof B)return;throw e}this.closed||(this.readyEmitted=!0,this.emit("ready"))})().finally(()=>{this.connecting=void 0})),this.connecting}closeRaw(){if(!this.closingPromise){let e=()=>{if(this.raw)try{this.raw.close()}catch(e){}};this.closingPromise=(this.activeBlockingCommands>0?Promise.resolve().then(e):this.operationChain.catch(()=>{}).then(async()=>{this.closed&&(this.raw&&await this.clearConnectionNameIfNeeded(this.raw),e())})).finally(()=>{this.closingPromise=void 0})}return this.closingPromise}disconnect(e=!1){if(!this.closed||e){if(this.closed=!0,this.readyEmitted=!1,this.statusOverride=e?void 0:"end",this.emit("close"),e)return void this.closeRaw().then(()=>(this.emit("reconnecting"),this.connect())).catch(e=>this.emit("error",e));this.closeRaw(),this.emit("end")}}async quit(){return this.closed?setImmediate(()=>{this.emit("end"),this.emit("close")}):(this.closed=!0,this.readyEmitted=!1,this.statusOverride="end",this.closeRaw(),setImmediate(()=>{this.emit("end"),this.emit("close")})),"OK"}duplicate(...e){var t;let r=null!=(t=e[0])?t:{};return new nu((async()=>{var e,t;let r=await this.ensureRaw(),n=r.constructor,i=null==(e=null==n?void 0:n.createClient)?void 0:e.bind(n),a=null!=(t=r.config)?t:r.options;if(!i||!a)throw Error("BullMQ: Cannot duplicate Valkey Glide client: missing createClient() or config. Ensure the client was created via GlideClient.createClient()/GlideClusterClient.createClient().");return i(a)})(),r.connectionName)}defineCommand(e,t){let r=(0,z.createHash)("sha1").update(t.lua).digest("hex"),n={sha:r,lua:t.lua,numberOfKeys:t.numberOfKeys};this.scripts.set(e,n),this.scriptsBySha.set(r,n),this[e]=(...t)=>this.runCommand(e,t),this.ensureScriptLoaded(n)}async runCommand(e,t){let r=this.scripts.get(e);if(!r)throw Error(`BullMQ: command "${e}" is not defined. Use defineCommand() before runCommand().`);let n=ns(t),i=n.slice(0,r.numberOfKeys).map(nn),a=n.slice(r.numberOfKeys).map(nn),s=["EVALSHA",r.sha,String(r.numberOfKeys),...i,...a];try{return await this.runRawCommand(s)}catch(e){if("string"==typeof(null==e?void 0:e.message)&&e.message.toLowerCase().includes("noscript"))return this.runRawCommand(["EVAL",r.lua,String(r.numberOfKeys),...i,...a]);throw e}}multi(){return new nh(this,this.scripts)}pipeline(){return this.multi()}async hgetall(e){return no(await this.runRawCommand(["HGETALL",e]))}async hget(e,t){let r=await this.runRawCommand(["HGET",e,t]);return null==r?null:ni(r)}async hmget(e,...t){let r=await this.runRawCommand(["HMGET",e,...t]);return Array.isArray(r)?r.map(e=>null==e?null:ni(e)):[]}async hset(e,t){let r=["HSET",e];for(let[e,n]of Object.entries(t))r.push(e,nn(n));return Number(await this.runRawCommand(r))}async hdel(e,...t){return Number(await this.runRawCommand(["HDEL",e,...t]))}async hexists(e,t){let r=await this.runRawCommand(["HEXISTS",e,t]);return"boolean"==typeof r?+!!r:Number(r)}async get(e){let t=await this.runRawCommand(["GET",e]);return null==t?null:ni(t)}async set(e,t,r){let n=["SET",e,nn(t)];(null==r?void 0:r.PX)!=null?n.push("PX",String(r.PX)):(null==r?void 0:r.EX)!=null&&n.push("EX",String(r.EX));let i=await this.runRawCommand(n);return null==i?null:ni(i)}async del(...e){return 0===e.length?0:Number(await this.runRawCommand(["DEL",...e]))}async zrange(e,t,r,n){let i=["ZRANGE",e,String(t),String(r)];return(null==n?void 0:n.WITHSCORES)&&i.push("WITHSCORES"),nd(await this.runRawCommand(i),null==n?void 0:n.WITHSCORES)}async zrevrange(e,t,r,n){let i=["ZREVRANGE",e,String(t),String(r)];return(null==n?void 0:n.WITHSCORES)&&i.push("WITHSCORES"),nd(await this.runRawCommand(i),null==n?void 0:n.WITHSCORES)}async zcard(e){return Number(await this.runRawCommand(["ZCARD",e]))}async zscore(e,t){let r=await this.runRawCommand(["ZSCORE",e,t]);return null==r?null:ni(r)}async lrange(e,t,r){let n=await this.runRawCommand(["LRANGE",e,String(t),String(r)]);return Array.isArray(n)?n.map(ni):[]}async llen(e){return Number(await this.runRawCommand(["LLEN",e]))}async ltrim(e,t,r){let n=await this.runRawCommand(["LTRIM",e,String(t),String(r)]);return null==n?"OK":ni(n)}async lpos(e,t){let r=await this.runRawCommand(["LPOS",e,t]);return null==r?null:Number(r)}async smembers(e){let t=await this.runRawCommand(["SMEMBERS",e]);return Array.isArray(t)?t.map(ni):[]}async xadd(e,t,r,n){let i=["XADD",e];for(let[e,a]of((null==n?void 0:n.MAXLEN)!=null&&(i.push("MAXLEN"),!1!==n.approximate&&i.push("~"),i.push(String(n.MAXLEN))),i.push(t),Object.entries(r)))i.push(e,nn(a));return ni(await this.runRawCommand(i))}async xread(e,t){var r;let n=["XREAD"];for(let r of((null==t?void 0:t.BLOCK)!=null&&n.push("BLOCK",String(t.BLOCK)),(null==t?void 0:t.COUNT)!=null&&n.push("COUNT",String(t.COUNT)),n.push("STREAMS"),e))n.push(r.key);for(let t of e)n.push(t.id);return(r=await this.runRawCommand(n))?Array.isArray(r)&&r.every(e=>Array.isArray(e)&&2===e.length&&void 0!==e[0]&&Array.isArray(e[1]))||!na(r)?r:r.map(e=>[ni(e.key),na(e.value)?e.value.map(e=>[ni(e.key),nl(e.value)]):[]]):null}async xtrim(e,t,r,n){let i=["XTRIM",e,t];return(null==n?void 0:n.approximate)!==!1&&i.push("~"),i.push(String(r)),Number(await this.runRawCommand(i))}async bzpopmin(e,t){let r=await this.runRawCommand(["BZPOPMIN",e,String(t)]);return r&&Array.isArray(r)&&r.length>=3?[ni(r[0]),ni(r[1]),ni(r[2])]:null}async info(){return ni(await this.runRawCommand(["INFO"]))}async clientSetName(e){return this.runRawCommand(["CLIENT","SETNAME",e],{decoder:1})}async clientList(){return ni(await this.runRawCommand(["CLIENT","LIST"],{decoder:1}))}async scan(e,t){let r=["SCAN",String(e)];return(null==t?void 0:t.MATCH)&&r.push("MATCH",t.MATCH),(null==t?void 0:t.COUNT)!=null&&r.push("COUNT",String(t.COUNT)),function(e){if(Array.isArray(e)&&e.length>=2){let[t,r]=e,n=Array.isArray(r)?r.map(e=>ni(e)):[];return[ni(t),n]}return e&&"object"==typeof e&&void 0!==e.cursor&&Array.isArray(e.keys)?[ni(e.cursor),e.keys.map(e=>ni(e))]:["0",[]]}(await this.runRawCommand(r))}scanStream(e){let t="0",r=!1,n=new tM.Readable({objectMode:!0,read:()=>{r||(r=!0,(async()=>{do{let[r,i]=await this.scan(t,{MATCH:e.match,COUNT:e.count});if(t=r,i.length>0&&!n.push(i))return}while("0"!==t)n.push(null)})().catch(e=>n.destroy(e)).finally(()=>{r=!1}))}});return n}async keys(e){let t=await this.runRawCommand(["KEYS",e]);return Array.isArray(t)?t.map(ni):[]}async exists(...e){if(0===e.length)return 0;let t=await this.runRawCommand(["EXISTS",...e]);return"boolean"==typeof t?+!!t:Number(t)}async zadd(e,...t){let r=["ZADD",e];for(let e=0;e<t.length;e+=2)r.push(nn(t[e]),nn(t[e+1]));return Number(await this.runRawCommand(r))}async zrem(e,...t){return Number(await this.runRawCommand(["ZREM",e,...t]))}async xlen(e){return Number(await this.runRawCommand(["XLEN",e]))}async xrevrange(e,t,r,...n){var i;let a=["XREVRANGE",e,t,r];return"COUNT"===n[0]&&a.push("COUNT",nn(n[1])),(i=await this.runRawCommand(a))?Array.isArray(i)&&i.every(e=>Array.isArray(e)&&2===e.length&&void 0!==e[0]&&Array.isArray(e[1]))?i.map(([e,t])=>[ni(e),t.map(e=>ni(e))]):na(i)?i.map(e=>[ni(e.key),nl(e.value)]):[]:[]}async sadd(e,...t){return Number(await this.runRawCommand(["SADD",e,...t.map(e=>nn(e))]))}async scard(e){return Number(await this.runRawCommand(["SCARD",e]))}async lpush(e,...t){return Number(await this.runRawCommand(["LPUSH",e,...t]))}async rpop(e){let t=await this.runRawCommand(["RPOP",e]);return null==t?null:ni(t)}async incr(e){return Number(await this.runRawCommand(["INCR",e]))}async incrby(e,t){return Number(await this.runRawCommand(["INCRBY",e,String(t)]))}async flushall(){let e=await this.runRawCommand(["FLUSHALL"]);return null==e?"OK":ni(e)}async execQueuedCommands(e){let t=e.map(e=>"EVALSHA"===String(e.args[0]).toUpperCase()?this.scriptsBySha.get(ni(e.args[1])):void 0).filter(e=>!!e);return t.length>0&&await Promise.all(t.map(e=>this.ensureScriptLoaded(e))),this.runSerialized(async t=>{if("function"==typeof t.exec){let r=function(e){try{let{Batch:t}=(()=>{let e=Error("Cannot find module '@valkey/valkey-glide'");throw e.code="MODULE_NOT_FOUND",e})();return"function"==typeof t?new t(e):null}catch(e){return null}}(!0),n=null!=r?r:{commands:[],customCommand(e){this.commands.push(e)}};if(n){let i;for(let t of e)n.customCommand(t.args);try{i=await t.exec(n,!1)}catch(e){if(r)throw e;i=null}if(i)return i.map((t,r)=>{var n;if(t instanceof Error)return[t,null];let i=null==(n=e[r])?void 0:n.transform;return[null,i?i(t):t]});if(r)return null}}await t.customCommand(["MULTI"]);try{for(let r of e)await t.customCommand(r.args,{decoder:1});let r=await t.customCommand(["EXEC"]);if(!r)return null;return(Array.isArray(r)?r:[r]).map((t,r)=>{var n;if(t instanceof Error)return[t,null];let i=null==(n=e[r])?void 0:n.transform;return[null,i?i(t):t]})}catch(e){try{await t.customCommand(["DISCARD"])}catch(e){}throw e}})}}class nh{constructor(e,t){this.adapter=e,this.scripts=t,this.commands=[]}queueCommand(e,t){return this.commands.push({args:e,transform:t}),this}hgetall(e){return this.queueCommand(["HGETALL",e],no)}hset(e,t){let r=["HSET",e];for(let[e,n]of Object.entries(t))r.push(e,nn(n));return this.queueCommand(r)}hscan(e,t,r){let n=["HSCAN",e,String(t)];return(null==r?void 0:r.COUNT)!=null&&n.push("COUNT",String(r.COUNT)),this.queueCommand(n,e=>Array.isArray(e)&&e.length>=2?[ni(e[0]),nl(e[1])]:["0",[]])}smembers(e){return this.queueCommand(["SMEMBERS",e],e=>Array.isArray(e)?e.map(e=>ni(e)):[])}sscan(e,t,r){let n=["SSCAN",e,String(t)];return(null==r?void 0:r.COUNT)!=null&&n.push("COUNT",String(r.COUNT)),this.queueCommand(n,e=>{if(Array.isArray(e)&&e.length>=2){let t=Array.isArray(e[1])?e[1].map(e=>ni(e)):[];return[ni(e[0]),t]}return["0",[]]})}zrange(e,t,r){return this.queueCommand(["ZRANGE",e,String(t),String(r)])}lrange(e,t,r){return this.queueCommand(["LRANGE",e,String(t),String(r)])}llen(e){return this.queueCommand(["LLEN",e])}del(...e){return e.length>0&&this.queueCommand(["DEL",...e]),this}runCommand(e,t){let r=this.scripts.get(e);if(!r)throw Error(`BullMQ: command "${e}" is not defined. Use defineCommand() before adding it to transactions.`);let n=ns(t),i=n.slice(0,r.numberOfKeys).map(nn),a=n.slice(r.numberOfKeys).map(nn);return this.queueCommand(["EVALSHA",r.sha,String(r.numberOfKeys),...i,...a])}exec(){return this.adapter.execQueuedCommands(this.commands)}}e.s(["createValkeyGlideClient",0,nc],29844);var np=e.i(8689),nm=q;class ny extends nm.EventEmitter{constructor(e,t={connection:{}},r=r5(),n=!1){if(super(),this.name=e,this.opts=t,this.closed=!1,this.hasBlockingConnection=!1,this.backendFactory=r,this.hasBlockingConnection=n,this.opts=Object.assign({},t),!e)throw Error("Queue name must be provided");if(e.includes(":"))throw Error("Queue name cannot contain :");this.createBackend(),this.qualifiedName=this.backend.qualifiedName,this.keys=this.backend.keys,this.toKey=e=>this.backend.toKey(e),this.backend.on("error",e=>this.emit("error",e)),this.backend.on("close",()=>{this.closing||this.emit("ioredis:close")})}waitUntilReady(){return this.backend.waitUntilReady()}getBackend(){return this.backend}createBackend(){this.backend=this.backendFactory(this.name,this.opts,{blocking:this.hasBlockingConnection})}get Job(){return r9}emit(e,...t){try{return super.emit(e,...t)}catch(e){try{return super.emit("error",e)}catch(e){return console.error(e),!1}}}base64Name(){return Buffer.from(this.name).toString("base64")}clientName(e=""){return this.backend.clientName(e)}async close(){this.closing||(this.closing=this.backend.close()),await this.closing,this.closed=!0}disconnect(){return this.backend.disconnect()}async checkConnectionError(e,t=5e3){try{return await e()}catch(e){if(ef(e)&&this.emit("error",e),this.closing||!t)return;await ei(t)}}trace(e,t,r,n,i){return ek(this.opts.telemetry,e,this.name,t,r,n,i)}}e.s(["QueueBase",0,ny],11684);let nf="https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6";function nb(e,t,r){if(t>=r)return!1;for(let n=t;n<r;n++){let t=e.charCodeAt(n);if(t<48||t>57)return!1}return!0}function ng(e){let t=e.indexOf(":");if(-1===t)return!1;let r=e.indexOf(":",t+1);if(-1===r)return!1;let n=e.indexOf(":",r+1);if(-1===n)return!1;let i=e.indexOf(":",n+1);if(-1===i||r+1<n&&!nb(e,r+1,n))return!1;let a=i+1;return!(a>=e.length)&&(-1!==e.indexOf(" ",a)||nb(e,a,e.length))}function nK(e){return Error(`Legacy repeatable job metadata is not supported in BullMQ v6 (key: "${e}"). Migrate legacy repeatable jobs to Job Schedulers before upgrading. See ${nf}`)}class nv extends ny{constructor(e,t,r){super(e,t,r),this.repeatStrategy=t.settings&&t.settings.repeatStrategy||nE}async upsertJobScheduler(e,t,r,n,i,{override:a,producerId:s}){let o,{every:l,limit:d,pattern:c,offset:u}=t;if(c&&l)throw Error("Both .pattern and .every options are defined for this repeatable job");if(!c&&!l)throw Error("Either .pattern or .every options must be defined for this repeatable job");if(t.immediately&&t.startDate)throw Error("Both .immediately and .startDate options are defined for this repeatable job");if(t.immediately&&t.every&&console.warn("Using option immediately with every does not affect the job's schedule. Job will run immediately anyway."),Object.prototype.hasOwnProperty.call(i,"debounce"))throw Error("Debounce option has been removed. Use deduplication option instead");let h=t.count?t.count+1:1;if(void 0!==t.limit&&h>t.limit)return;let p=Date.now(),{endDate:m}=t;if(m&&p>new Date(m).getTime())return;let y=i.prevMillis||0;p=y<p?p:y;let{immediately:f}=t,b=(0,tU.__rest)(t,["immediately"]),g=l&&u?u:null;if(c&&(o=await this.repeatStrategy(p,t,r))<p&&(o=p),o||l)return this.trace(k.PRODUCER,"add",`${this.name}.${r}`,async(u,y)=>{var f,K;let v=i.telemetry;if(y){let e=null==(f=i.telemetry)?void 0:f.omitContext,t=(null==(K=i.telemetry)?void 0:K.metadata)||!e&&y;(t||e)&&(v={metadata:t,omitContext:e})}let E=this.getNextJobOpts(o,e,Object.assign(Object.assign({},i),{repeat:b,telemetry:v}),h,g);if(a){o<p&&(o=p);let[a,h]=await this.backend.addJobScheduler(e,o,JSON.stringify(void 0===n?{}:n),i,{name:r,startDate:t.startDate?new Date(t.startDate).getTime():void 0,endDate:m?new Date(m).getTime():void 0,tz:t.tz,pattern:c,every:l,limit:d,offset:g},E,s),y="string"==typeof h?parseInt(h,10):h,f=new this.Job(this,r,n,Object.assign(Object.assign({},E),{delay:y}),a);return f.id=a,null==u||u.setAttributes({[w.JobSchedulerId]:e,[w.JobId]:f.id}),f}{let t=await this.backend.updateJobSchedulerNextMillis(e,o,JSON.stringify(void 0===n?{}:n),E,s);if(t){let i=new this.Job(this,r,n,E,t);return i.id=t,null==u||u.setAttributes({[w.JobSchedulerId]:e,[w.JobId]:i.id}),i}}})}getNextJobOpts(e,t,r,n,i){var a,s;let o=this.getSchedulerNextJobId({jobSchedulerId:t,nextMillis:e}),l=Date.now(),d=e+i-l,c=Object.assign(Object.assign({},r),{jobId:o,delay:d<0?0:d,timestamp:l,prevMillis:e,repeatJobKey:t});return c.repeat=Object.assign(Object.assign({},r.repeat),{offset:i,count:n,startDate:(null==(a=r.repeat)?void 0:a.startDate)?new Date(r.repeat.startDate).getTime():void 0,endDate:(null==(s=r.repeat)?void 0:s.endDate)?new Date(r.repeat.endDate).getTime():void 0}),c}async removeJobScheduler(e){return this.backend.removeJobScheduler(e)}async getSchedulerData(e,t){let r=await this.backend.getJobSchedulerData(e),n=this.transformSchedulerData(e,r,t);return n||await this.backend.removeJobScheduler(e),n}transformSchedulerData(e,t,r){if(t&&Object.keys(t).length>0){let n={key:e,name:t.name,next:r};return t.ic&&(n.iterationCount=parseInt(t.ic)),t.limit&&(n.limit=parseInt(t.limit)),t.startDate&&(n.startDate=parseInt(t.startDate)),t.endDate&&(n.endDate=parseInt(t.endDate)),t.tz&&(n.tz=t.tz),t.pattern&&(n.pattern=t.pattern),t.every&&(n.every=parseInt(t.every)),t.offset&&(n.offset=parseInt(t.offset)),(t.data||t.opts)&&(n.template=this.getTemplateFromJSON(t.data,t.opts)),n}if(ng(e))throw nK(e)}async isJobScheduler(e){return this.backend.isJobScheduler(e)}async getScheduler(e){let[t,r]=await this.backend.getJobScheduler(e);return this.transformSchedulerData(e,t?er(t):null,r?parseInt(r):null)}getTemplateFromJSON(e,t){let r={};return e&&(r.data=JSON.parse(e)),t&&(r.opts=r9.optsFromJSON(t)),r}async getJobSchedulers(e=0,t=-1,r=!1){let n=await this.backend.getJobSchedulersRange(e,t,r),i=[];for(let e=0;e<n.length;e+=2)i.push(this.getSchedulerData(n[e],parseInt(n[e+1])));return(await Promise.all(i)).filter(e=>!!e)}async getSchedulersCount(){return this.backend.getJobSchedulersCount()}getSchedulerNextJobId({nextMillis:e,jobSchedulerId:t}){return`repeat:${t}:${e}`}}let nE=(e,t)=>{let{pattern:r}=t,n=new Date(e),i=t.startDate&&new Date(t.startDate),a=np.CronExpressionParser.parse(r,Object.assign(Object.assign({},t),{currentDate:i>n?i:n}));try{if(t.immediately)return new Date().getTime();return a.next().getTime()}catch(e){}},nI=(e,t)=>{let r=t.pattern;if(r&&t.every)throw Error("Both .pattern and .every options are defined for this repeatable job");if(t.every)return Math.floor(e/t.every)*t.every+(t.immediately?0:t.every);let n=new Date(t.startDate&&new Date(t.startDate)>new Date(e)?t.startDate:e),i=np.CronExpressionParser.parse(r,Object.assign(Object.assign({},t),{currentDate:n}));try{if(t.immediately)return new Date().getTime();return i.next().getTime()}catch(e){}};e.s(["JobScheduler",0,nv,"LEGACY_REPEATABLE_JOBS_MIGRATION_URL",0,nf,"defaultRepeatStrategy",0,nE,"getLegacyRepeatableJobError",0,nK,"getNextMillis",0,nI,"hasLegacyRepeatableKeyShape",0,ng,"isLegacyRepeatableJobKey",0,ng],30791);class nw{constructor(e,t){this.worker=e,this.opts=t,this.trackedJobs=new Map,this.closed=!1}start(){!this.closed&&this.opts.lockRenewTime>0&&this.startLockExtenderTimer()}async extendLocks(e){await this.worker.trace(k.INTERNAL,"extendLocks",this.worker.name,async t=>{null==t||t.setAttributes({[w.WorkerId]:this.opts.workerId,[w.WorkerName]:this.opts.workerName,[w.WorkerJobsToExtendLocks]:e});try{let t=e.map(e=>{var t;return(null==(t=this.trackedJobs.get(e))?void 0:t.token)||""}),r=await this.worker.extendJobLocks(e,t,this.opts.lockDuration);if(r.length>0)for(let e of(this.worker.emit("lockRenewalFailed",r),r))this.worker.emit("error",Error(`could not renew lock for job ${e}`));let n=e.filter(e=>!r.includes(e));n.length>0&&this.worker.emit("locksRenewed",{count:n.length,jobIds:n})}catch(e){this.worker.emit("error",e)}})}startLockExtenderTimer(){clearTimeout(this.lockRenewalTimer),this.closed||(this.lockRenewalTimer=setTimeout(async()=>{let e=Date.now(),t=[];for(let r of this.trackedJobs.keys()){let{ts:n,token:i,abortController:a}=this.trackedJobs.get(r);if(!n){this.trackedJobs.set(r,{token:i,ts:e,abortController:a});continue}n+this.opts.lockRenewTime/2<e&&(this.trackedJobs.set(r,{token:i,ts:e,abortController:a}),t.push(r))}t.length&&await this.extendLocks(t),this.startLockExtenderTimer()},this.opts.lockRenewTime/2))}async close(){this.closed||(this.closed=!0,this.lockRenewalTimer&&(clearTimeout(this.lockRenewalTimer),this.lockRenewalTimer=void 0),this.trackedJobs.clear())}trackJob(e,t,r,n=!1){let i=n?new U:void 0;return!this.closed&&e&&this.trackedJobs.set(e,{token:t,ts:r,abortController:i}),i}untrackJob(e){this.trackedJobs.delete(e)}getActiveJobCount(){return this.trackedJobs.size}isRunning(){return!this.closed&&void 0!==this.lockRenewalTimer}cancelJob(e,t){let r=this.trackedJobs.get(e);return null!=r&&!!r.abortController&&(r.abortController.abort(t),!0)}cancelAllJobs(e){for(let t of this.trackedJobs.values())t.abortController&&t.abortController.abort(e)}getTrackedJobIds(){return Array.from(this.trackedJobs.keys())}}e.s(["LockManager",0,nw],98291);class nS extends ny{constructor(e,t={connection:{}},r){var{connection:n,autorun:i=!0}=t;super(e,Object.assign(Object.assign({},(0,tU.__rest)(t,["connection","autorun"])),{connection:ec(n)?(rL(n)?n:rP(n)).duplicate():n}),r,!0),this.running=!1,this.blocking=!1,this.opts=Object.assign({blockingTimeout:1e4},this.opts),i&&this.run().catch(e=>this.emit("error",e))}emit(e,...t){return super.emit(e,...t)}off(e,t){return super.off(e,t),this}on(e,t){return super.on(e,t),this}once(e,t){return super.once(e,t),this}async run(){if(this.running)throw Error("Queue Events is already running.");try{this.running=!0,await this.backend.setName(this.clientName(":qe")),await this.consumeEvents()}catch(e){throw this.running=!1,e}}async consumeEvents(){let e=this.opts,t=e.lastEventId||"$";for(;!this.closing;){this.blocking=!0;let r=await this.checkConnectionError(()=>this.backend.readEvents(t,e.blockingTimeout));if(this.blocking=!1,r){let e=r[0][1];for(let r=0;r<e.length;r++){t=e[r][0];let n=er(e[r][1]);switch(n.event){case"progress":n.data=JSON.parse(n.data);break;case"completed":n.returnvalue=JSON.parse(n.returnvalue);break;case"delayed":n.delay=Number(n.delay)}let{event:i}=n,a=(0,tU.__rest)(n,["event"]);"drained"===i?this.emit(i,t):(this.emit(i,a,t),a.jobId&&this.emit(`${i}:${a.jobId}`,a,t))}}}}async close(){return this.closing||(this.closing=(async()=>{try{await this.backend.disconnect(),await this.backend.close()}finally{this.closed=!0}})()),this.closing}}e.s(["QueueEvents",0,nS],54674);class nk extends ny{constructor(e,t={connection:{}},r){super(e,Object.assign({blockingConnection:!1},t),r),this.opts=t}async publishEvent(e,t=1e3){let{eventName:r}=e,n=Object.assign({event:r},(0,tU.__rest)(e,["eventName"]));await this.backend.publishEvent(n,t)}async close(){this.closing||(this.closing=this.backend.close()),await this.closing}}function nj(e){return String(e).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n")}e.s(["QueueEventsProducer",0,nk],21851);class nx extends ny{getJob(e){return this.Job.fromId(this,e)}commandByType(e,t,r){return e.map(e=>{e="waiting"===e?"wait":e;let n=this.toKey(e);switch(e){case"completed":case"failed":case"delayed":case"prioritized":case"repeat":case"waiting-children":return r(n,t?"zcard":"zrange");case"active":case"wait":return r(n,t?"llen":"lrange")}})}sanitizeJobTypes(e){let t="string"==typeof e?[e]:e;return Array.isArray(t)&&t.length>0?[...new Set([...t])]:["active","completed","delayed","failed","prioritized","waiting","waiting-children"]}async count(){return await this.getJobCountByTypes("waiting","delayed","prioritized","waiting-children")}async getRateLimitTtl(e){return this.backend.getRateLimitTtl(e)}async getDebounceJobId(e){return this.backend.getDeduplicationJobId(e)}async getDeduplicationJobId(e){return this.backend.getDeduplicationJobId(e)}async getGlobalConcurrency(){let e=await this.backend.getQueueMetaField("concurrency");return e?Number(e):null}async getGlobalRateLimit(){let[e,t]=await this.backend.getQueueMetaFields(["max","duration"]);return e&&t?{max:Number(e),duration:Number(t)}:null}async getJobCountByTypes(...e){return Object.values(await this.getJobCounts(...e)).reduce((e,t)=>e+t,0)}async getJobCounts(...e){let t=this.sanitizeJobTypes(e),r=await this.backend.getCounts(t),n={};return r.forEach((e,r)=>{n[t[r]]=e||0}),n}async recordJobCountsMetric(...e){var t;let r=await this.getJobCounts(...e),n=null==(t=this.opts.telemetry)?void 0:t.meter;if(n){let e=n.createGauge(S.QueueJobsCount,{description:"Number of jobs in the queue by state",unit:"{jobs}"});for(let[t,n]of Object.entries(r))e.record(n,{[w.QueueName]:this.name,[w.QueueJobsState]:t})}return r}getJobState(e){return this.backend.getState(e)}async getMeta(){let e=await this.backend.getQueueMeta(),{concurrency:t,max:r,duration:n,paused:i,"opts.maxLenEvents":a}=e,s=(0,tU.__rest)(e,["concurrency","max","duration","paused","opts.maxLenEvents"]);return t&&(s.concurrency=Number(t)),a&&(s.maxLenEvents=Number(a)),r&&(s.max=Number(r)),n&&(s.duration=Number(n)),s.paused="1"===i,s}getCompletedCount(){return this.getJobCountByTypes("completed")}getFailedCount(){return this.getJobCountByTypes("failed")}getDelayedCount(){return this.getJobCountByTypes("delayed")}getActiveCount(){return this.getJobCountByTypes("active")}getPrioritizedCount(){return this.getJobCountByTypes("prioritized")}async getCountsPerPriority(e){let t=[...new Set(e)],r=await this.backend.getCountsPerPriority(t),n={};return r.forEach((e,r)=>{n[`${t[r]}`]=e||0}),n}getWaitingCount(){return this.getJobCountByTypes("waiting")}getWaitingChildrenCount(){return this.getJobCountByTypes("waiting-children")}getWaiting(e=0,t=-1){return this.getJobs(["waiting"],e,t,!0)}getWaitingChildren(e=0,t=-1){return this.getJobs(["waiting-children"],e,t,!0)}getActive(e=0,t=-1){return this.getJobs(["active"],e,t,!0)}getDelayed(e=0,t=-1){return this.getJobs(["delayed"],e,t,!0)}getPrioritized(e=0,t=-1){return this.getJobs(["prioritized"],e,t,!0)}getCompleted(e=0,t=-1){return this.getJobs(["completed"],e,t,!1)}getFailed(e=0,t=-1){return this.getJobs(["failed"],e,t,!1)}async getDependencies(e,t,r,n){let i=this.toKey("processed"==t?`${e}:processed`:`${e}:dependencies`),{items:a,total:s,jobs:o}=await this.backend.paginate(i,{start:r,end:n,fetchJobs:!0});return{items:a,jobs:o,total:s}}async getRanges(e,t=0,r=1,n=!1){let i=[];this.commandByType(e,!1,(e,t)=>{switch(t){case"lrange":i.push("lrange");break;case"zrange":i.push("zrange")}});let a=await this.backend.getRanges(e,t,r,n),s=[];return a.forEach((e,t)=>{let r=e||[];s=n&&"lrange"===i[t]?s.concat(r.reverse()):s.concat(r)}),[...new Set(s)]}async getJobs(e,t=0,r=-1,n=!1){let i,a=this.sanitizeJobTypes(e),s=this.getBackend();if(s instanceof tG){let e=await s.getJobs(a,t,r,n),o=new Set;i=e.reduce((e,t)=>{for(let[r]of t||[])o.has(r)||(o.add(r),e.push(r));return e},[])}else i=await this.getRanges(a,t,r,n);return(await Promise.all(i.map(e=>this.getJob(e)))).filter(Boolean)}async getJobLogs(e,t=0,r=-1,n=!0){return this.backend.getJobLogs(e,t,r,n)}async baseGetClients(e){var t;try{let r=await this.backend.getClientList();if(r.length>1)return r.map(t=>this.parseClientList(t,e)).reduce((e,t)=>e.length>t.length?e:t,[]);return this.parseClientList(null!=(t=r[0])?t:"",e)}catch(e){if(!ey.test(e.message))throw e;return[{name:"GCP does not support client list"}]}}getWorkers(){let e=`${this.clientName()}`,t=`${this.clientName()}:w:`;return this.baseGetClients(r=>r&&(r===e||r.startsWith(t)))}async getWorkersCount(){return(await this.getWorkers()).length}async getQueueEvents(){let e=`${this.clientName()}:qe`;return this.baseGetClients(t=>t===e)}async getMetrics(e,t=0,r=-1){let[n,i,a]=await this.backend.getMetrics(e,t,r);return{meta:{count:parseInt(n[0]||"0",10),prevTS:parseInt(n[1]||"0",10),prevCount:parseInt(n[2]||"0",10)},data:i.map(e=>+e||0),count:a}}parseClientList(e,t){let r=e.split(/\r?\n/),n=[];return r.forEach(e=>{let r={};e.split(" ").forEach(function(e){let t=e.indexOf("="),n=e.substring(0,t),i=e.substring(t+1);r[n]=i});let i=r.name;t(i)&&(r.name=this.name,r.rawname=i,n.push(r))}),n}async exportPrometheusMetrics(e){let t=await this.getJobCounts(),r=[];r.push("# HELP bullmq_job_count Number of jobs in the queue by state"),r.push("# TYPE bullmq_job_count gauge");let n=nj(this.name),i=e?Object.keys(e).reduce((t,r)=>`${t}, ${r}="${nj(e[r])}"`,""):"";for(let[e,a]of Object.entries(t))r.push(`bullmq_job_count{queue="${n}", state="${e}"${i}} ${a}`);let[a,s]=await Promise.all([this.getMetrics("completed"),this.getMetrics("failed")]);return r.push("# HELP bullmq_job_completed_total Total number of completed jobs"),r.push("# TYPE bullmq_job_completed_total counter"),r.push(`bullmq_job_completed_total{queue="${n}"${i}} ${a.meta.count}`),r.push("# HELP bullmq_job_failed_total Total number of failed jobs"),r.push("# TYPE bullmq_job_failed_total counter"),r.push(`bullmq_job_failed_total{queue="${n}"${i}} ${s.meta.count}`),r.join("\n")}}e.s(["QueueGetters",0,nx],19811);class nD extends nx{constructor(e,t,r){var n;super(e,Object.assign({},t),r),this.token=(0,z.randomUUID)(),this.libName="bullmq",this.jobsOpts=null!=(n=null==t?void 0:t.defaultJobOptions)?n:{},this.queueMetaInitialized=this.waitUntilReady().then(()=>{if(!this.closing&&!(null==t?void 0:t.skipMetasUpdate))return this.backend.setQueueMeta(this.metaValues).then(()=>void 0)}).catch(e=>{})}emit(e,...t){return super.emit(e,...t)}off(e,t){return super.off(e,t),this}on(e,t){return super.on(e,t),this}once(e,t){return super.once(e,t),this}get defaultJobOptions(){return Object.assign({},this.jobsOpts)}get metaValues(){var e,t,r,n;return{"opts.maxLenEvents":null!=(n=null==(r=null==(t=null==(e=this.opts)?void 0:e.streams)?void 0:t.events)?void 0:r.maxLen)?n:1e4,version:`${this.libName}:${tN}`}}async getVersion(){var e;return(null==(e=this.opts)?void 0:e.skipMetasUpdate)||await this.queueMetaInitialized,await this.backend.getQueueMetaField("version")}get jobScheduler(){return new Promise(async e=>{this._jobScheduler||(this._jobScheduler=new nv(this.name,this.opts,()=>this.backend),this._jobScheduler.on("error",this.emit.bind(this,"error"))),e(this._jobScheduler)})}async setGlobalConcurrency(e){return this.backend.setQueueMeta({concurrency:e})}async setGlobalRateLimit(e,t){return this.backend.setQueueMeta({max:e,duration:t})}async removeGlobalConcurrency(){return this.backend.removeQueueMetaFields(["concurrency"])}async removeGlobalRateLimit(){return this.backend.removeQueueMetaFields(["max","duration"])}async add(e,t,r){return this.trace(k.PRODUCER,"add",`${this.name}.${e}`,async(n,i)=>{var a;!i||(null==(a=null==r?void 0:r.telemetry)?void 0:a.omitContext)||(r=Object.assign(Object.assign({},r),{telemetry:{metadata:i}}));let s=await this.addJob(e,t,r);return null==n||n.setAttributes({[w.JobName]:e,[w.JobId]:s.id}),s})}async addJob(e,t,r){let n=null==r?void 0:r.jobId;if("0"==n||(null==n?void 0:n.startsWith("0:")))throw Error("JobId cannot be '0' or start with '0:'");let i=Object.assign(Object.assign(Object.assign({},this.jobsOpts),r),{jobId:n}),a=await this.Job.create(this,e,t,i);return this.emit("waiting",a),a}async addBulk(e){return this.trace(k.PRODUCER,"addBulk",this.name,async(t,r)=>(t&&t.setAttributes({[w.BulkNames]:e.map(e=>e.name),[w.BulkCount]:e.length}),await this.Job.createBulk(this,e.map(e=>{var t,n,i,a,s,o;let l=null==(t=e.opts)?void 0:t.telemetry;if(r){let t=null==(i=null==(n=e.opts)?void 0:n.telemetry)?void 0:i.omitContext,o=(null==(s=null==(a=e.opts)?void 0:a.telemetry)?void 0:s.metadata)||!t&&r;(o||t)&&(l={metadata:o,omitContext:t})}let d=Object.assign(Object.assign(Object.assign({},this.jobsOpts),e.opts),{jobId:null==(o=e.opts)?void 0:o.jobId,telemetry:l});return{name:e.name,data:e.data,opts:d}}))))}async upsertJobScheduler(e,t,r){var n,i;if(t.endDate&&+new Date(t.endDate)<Date.now())throw Error("End date must be greater than current timestamp");return(await this.jobScheduler).upsertJobScheduler(e,t,null!=(n=null==r?void 0:r.name)?n:e,null!=(i=null==r?void 0:r.data)?i:{},Object.assign(Object.assign({},this.jobsOpts),null==r?void 0:r.opts),{override:!0})}async pause(){await this.trace(k.INTERNAL,"pause",this.name,async()=>{await this.backend.pause(!0),this.emit("paused")})}async close(){await this.trace(k.INTERNAL,"close",this.name,async()=>{await super.close()})}async rateLimit(e){await this.trace(k.INTERNAL,"rateLimit",this.name,async t=>{null==t||t.setAttributes({[w.QueueRateLimit]:e}),await this.backend.setRateLimit(e)})}async resume(){await this.trace(k.INTERNAL,"resume",this.name,async()=>{await this.backend.pause(!1),this.emit("resumed")})}async isPaused(){return this.backend.hasQueueMetaField("paused")}isMaxed(){return this.backend.isMaxed()}async getJobScheduler(e){return(await this.jobScheduler).getScheduler(e)}async getJobSchedulers(e,t,r){return(await this.jobScheduler).getJobSchedulers(e,t,r)}async getJobSchedulersCount(){return(await this.jobScheduler).getSchedulersCount()}async removeJobScheduler(e){let t=await this.jobScheduler;return!await t.removeJobScheduler(e)}async removeDebounceKey(e){return this.trace(k.INTERNAL,"removeDebounceKey",`${this.name}`,async t=>(null==t||t.setAttributes({[w.JobKey]:e}),await this.backend.deleteDeduplicationKey(e)))}async removeDeduplicationKey(e){return this.trace(k.INTERNAL,"removeDeduplicationKey",`${this.name}`,async t=>(null==t||t.setAttributes({[w.DeduplicationKey]:e}),this.backend.deleteDeduplicationKey(e)))}async removeRateLimitKey(){return this.backend.removeRateLimitKey()}async remove(e,{removeChildren:t=!0}={}){return this.trace(k.INTERNAL,"remove",this.name,async r=>{null==r||r.setAttributes({[w.JobId]:e,[w.JobOptions]:JSON.stringify({removeChildren:t})});let n=await this.backend.remove(e,t);return 1===n&&this.emit("removed",e),n})}async updateJobProgress(e,t){await this.trace(k.INTERNAL,"updateJobProgress",this.name,async r=>{null==r||r.setAttributes({[w.JobId]:e,[w.JobProgress]:JSON.stringify(t)}),await this.backend.updateProgress(e,t),this.emit("progress",e,t)})}async addJobLog(e,t,r){return r9.addJobLog(this,e,t,r)}async drain(e=!1){await this.trace(k.INTERNAL,"drain",this.name,async t=>{null==t||t.setAttributes({[w.QueueDrainDelay]:e}),await this.backend.drain(e)})}async clean(e,t,r="completed"){return this.trace(k.INTERNAL,"clean",this.name,async n=>{let i=t||1/0,a=Math.min(1e4,i),s=Date.now()-e,o=0,l=[],d="waiting"===r?"wait":r;for(;o<i;){let e=await this.backend.cleanJobsByState(d,s,a);if(this.emit("cleaned",e,d),o+=e.length,l.push(...e),e.length<a)break}return null==n||n.setAttributes({[w.QueueGrace]:e,[w.JobType]:r,[w.QueueCleanLimit]:i,[w.QueueCleanCount]:o}),l})}async obliterate(e){await this.trace(k.INTERNAL,"obliterate",this.name,async()=>{await this.pause();let t=0;do t=await this.backend.obliterate(Object.assign({force:!1,count:1e3},e));while(t)})}async retryJobs(e={}){await this.trace(k.PRODUCER,"retryJobs",this.name,async t=>{null==t||t.setAttributes({[w.QueueOptions]:JSON.stringify(e)});let r=0;do r=await this.backend.retryFinishedJobs(e.state,e.count,e.timestamp);while(r)})}async promoteJobs(e={}){await this.trace(k.INTERNAL,"promoteJobs",this.name,async t=>{null==t||t.setAttributes({[w.QueueOptions]:JSON.stringify(e)});let r=0;do r=await this.backend.promoteJobs(e.count);while(r)})}async trimEvents(e){return this.trace(k.INTERNAL,"trimEvents",this.name,async t=>(null==t||t.setAttributes({[w.QueueEventMaxLength]:e}),await this.backend.trimEvents(e)))}async removeDeprecatedPriorityKey(){return this.backend.removeDeprecatedPriorityKey()}async removeOrphanedJobs(e=1e3,t=0){return this.backend.removeOrphanedJobs(e,t)}}e.s(["Queue",0,nD],28998);let nC=(e,t)=>async function(r,n,i){let a,s,o,l;try{let d=new Promise((d,c)=>{(async()=>{try{o=(e,t)=>{c(Error("Unexpected exit code: "+e+" signal: "+t))},(a=await t.retain(e)).on("exit",o),s=async e=>{var t,n,i,s,o,l;try{switch(e.cmd){case E.Completed:d(e.value);break;case E.Failed:case E.Error:{let r=Error();Object.assign(r,null!=(t=e.value)?t:e.err),c(r);break}case E.Progress:await r.updateProgress(e.value);break;case E.Log:await r.log(e.value);break;case E.MoveToDelayed:await r.moveToDelayed(null==(n=e.value)?void 0:n.timestamp,null==(i=e.value)?void 0:i.token);break;case E.MoveToWait:await r.moveToWait(null==(s=e.value)?void 0:s.token);break;case E.MoveToWaitingChildren:{let t=await r.moveToWaitingChildren(null==(o=e.value)?void 0:o.token,null==(l=e.value)?void 0:l.opts);a.send({requestId:e.requestId,cmd:K.MoveToWaitingChildrenResponse,value:t})}break;case E.Update:await r.updateData(e.value);break;case E.GetChildrenValues:{let t=await r.getChildrenValues();a.send({requestId:e.requestId,cmd:K.GetChildrenValuesResponse,value:t})}break;case E.GetIgnoredChildrenFailures:{let t=await r.getIgnoredChildrenFailures();a.send({requestId:e.requestId,cmd:K.GetIgnoredChildrenFailuresResponse,value:t})}break;case E.GetDependenciesCount:{let t=await r.getDependenciesCount(e.value);a.send({requestId:e.requestId,cmd:K.GetDependenciesCountResponse,value:t})}break;case E.GetDependencies:{let t=await r.getDependencies(e.value);a.send({requestId:e.requestId,cmd:K.GetDependenciesResponse,value:t})}}}catch(e){c(e)}},a.on("message",s),a.send({cmd:K.Start,job:r.asJSONSandbox(),token:n}),i&&(l=()=>{try{a.send({cmd:K.Cancel,value:i.reason})}catch(e){}},i.aborted?l():i.addEventListener("abort",l,{once:!0}))}catch(e){c(e)}})()});return await d,d}finally{i&&l&&i.removeEventListener("abort",l),a&&(a.off("message",s),a.off("exit",o),null===a.exitCode&&null===a.signalCode&&t.release(a))}};e.s(["default",0,nC],8889);var nT=e.i(22734),nO=e.i(92509);class nR{constructor(e){this.value=void 0,this.next=null,this.value=e}}class nA{constructor(){this.length=0,this.head=null,this.tail=null}push(e){let t=new nR(e);return this.length?this.tail.next=t:this.head=t,this.tail=t,this.length+=1,t}shift(){if(!this.length)return null;{let e=this.head;return this.head=this.head.next,this.length-=1,e}}}class nM{constructor(e=!1){this.ignoreErrors=e,this.queue=new nA,this.pending=new Set,this.newPromise()}add(e){this.pending.add(e),e.then(t=>{this.pending.delete(e),0===this.queue.length&&this.resolvePromise(t),this.queue.push(t)}).catch(t=>{this.ignoreErrors&&this.queue.push(void 0),this.pending.delete(e),this.rejectPromise(t)})}async waitAll(){await Promise.all(this.pending)}numTotal(){return this.pending.size+this.queue.length}numPending(){return this.pending.size}numQueued(){return this.queue.length}resolvePromise(e){this.resolve(e),this.newPromise()}rejectPromise(e){this.reject(e),this.newPromise()}newPromise(){this.nextPromise=new Promise((e,t)=>{this.resolve=e,this.reject=t})}async wait(){return this.nextPromise}async fetch(){var e;if(0!==this.pending.size||0!==this.queue.length){for(;0===this.queue.length;)try{await this.wait()}catch(e){this.ignoreErrors||console.error("Unexpected Error in AsyncFifoQueue",e)}return null==(e=this.queue.shift())?void 0:e.value}}}e.s(["AsyncFifoQueue",0,nM],32116);let nN="bullmq:movedToDelayed";class nP extends Error{constructor(e=nN){super(e),this.name=this.constructor.name,Object.setPrototypeOf(this,new.target.prototype)}}e.s(["DELAYED_ERROR",0,nN,"DelayedError",0,nP],51020);let nJ="bullmq:rateLimitExceeded";class nL extends Error{constructor(e=nJ){super(e),this.name=this.constructor.name,Object.setPrototypeOf(this,new.target.prototype)}}e.s(["RATE_LIMIT_ERROR",0,nJ,"RateLimitError",0,nL],42532);let nq="bullmq:movedToWaitingChildren";class nF extends Error{constructor(e=nq){super(e),this.name=this.constructor.name,Object.setPrototypeOf(this,new.target.prototype)}}e.s(["WAITING_CHILDREN_ERROR",0,nq,"WaitingChildrenError",0,nF],36076);let nV="bullmq:movedToWait";class n_ extends Error{constructor(e=nV){super(e),this.name=this.constructor.name,Object.setPrototypeOf(this,new.target.prototype)}}e.s(["WAITING_ERROR",0,nV,"WaitingError",0,n_],31636);class nG extends ny{static RateLimitError(){return new nL}constructor(e,t,r,n){if(super(e,Object.assign(Object.assign({drainDelay:5,concurrency:1,lockDuration:3e4,maximumRateLimitDelay:3e4,maxStalledCount:1,stalledInterval:3e4,autorun:!0,runRetryDelay:15e3},r),{blockingConnection:!0}),n),this.abortDelayController=null,this.blockUntil=0,this.drained=!1,this.limitUntil=0,this.processorAcceptsSignal=!1,this.stalledCheckerRunning=!1,this.waiting=null,this.running=!1,this.mainLoopRunning=null,!r||!r.connection)throw Error("Worker requires a connection");if("number"!=typeof this.opts.maxStalledCount||this.opts.maxStalledCount<0)throw Error("maxStalledCount must be greater or equal than 0");if("number"==typeof this.opts.maxStartedAttempts&&this.opts.maxStartedAttempts<0)throw Error("maxStartedAttempts must be greater or equal than 0");if("number"!=typeof this.opts.stalledInterval||this.opts.stalledInterval<=0)throw Error("stalledInterval must be greater than 0");if("number"!=typeof this.opts.drainDelay||this.opts.drainDelay<=0)throw Error("drainDelay must be greater than 0");if(this.concurrency=this.opts.concurrency,this.opts.lockRenewTime=this.opts.lockRenewTime||this.opts.lockDuration/2,this.id=(0,z.randomUUID)(),this.createLockManager(),t){if("function"==typeof t)this.processFn=t,this.processorAcceptsSignal=t.length>=3;else{if(t instanceof nO.URL){if(!nT.existsSync(t))throw Error(`URL ${t} does not exist in the local file system`);t=t.href}else{const e=t+([".js",".ts",".flow",".cjs",".mjs"].includes(Y.extname(t))?"":".js");if(!nT.existsSync(e))throw Error(`File ${e} does not exist`)}const e=Y.dirname(module.filename||"/ROOT/node_modules/bullmq/dist/esm/classes/worker.js"),r=Y.join(e,"main-worker.js"),n=Y.join(e,"main.js");let i=this.opts.useWorkerThreads?r:n;try{nT.statSync(i)}catch(t){const e=this.opts.useWorkerThreads?"main-worker.js":"main.js";i=Y.join(process.cwd(),`dist/cjs/classes/${e}`),nT.statSync(i)}this.childPool=new $({mainFile:i,useWorkerThreads:this.opts.useWorkerThreads,workerForkOptions:this.opts.workerForkOptions,workerThreadsOptions:this.opts.workerThreadsOptions}),this.createSandbox(t),this.processorAcceptsSignal=!0}this.opts.autorun&&this.run().catch(e=>this.emit("error",e))}this.backend.waitUntilReady().then(()=>setTimeout(()=>this.emit("ready"),0)).catch(()=>{})}createBackend(){this.backend=this.backendFactory(this.name,this.opts,{withBlockingConnection:!0})}createLockManager(){this.lockManager=new nw(this,{lockRenewTime:this.opts.lockRenewTime,lockDuration:this.opts.lockDuration,workerId:this.id,workerName:this.opts.name})}createSandbox(e){this.processFn=nC(e,this.childPool).bind(this)}async extendJobLocks(e,t,r){return this.backend.extendLocks(e,t,r)}emit(e,...t){return super.emit(e,...t)}off(e,t){return super.off(e,t),this}on(e,t){return super.on(e,t),this}once(e,t){return super.once(e,t),this}callProcessJob(e,t,r){return this.processFn(e,t,r)}createJob(e,t){return this.Job.fromJSON(this,e,t)}async waitUntilReady(){await super.waitUntilReady()}cancelJob(e,t){return this.lockManager.cancelJob(e,t)}cancelAllJobs(e){this.lockManager.cancelAllJobs(e)}set concurrency(e){if("number"!=typeof e||e<1||!isFinite(e))throw Error("concurrency must be a finite number greater than 0");this._concurrency=e}get concurrency(){return this._concurrency}get jobScheduler(){return new Promise(async e=>{this._jobScheduler||(this._jobScheduler=new nv(this.name,this.opts,()=>this.backend),this._jobScheduler.on("error",this.emit.bind(this,"error"))),e(this._jobScheduler)})}async run(){if(!this.processFn)throw Error("No process function is defined.");if(this.running)throw Error("Worker is already running.");try{if(this.running=!0,this.closing||this.paused)return;await this.startStalledCheckTimer(),this.opts.skipLockRenewal||this.lockManager.start(),this.mainLoopRunning=this.mainLoop(),await this.mainLoopRunning}finally{this.running=!1}}async waitForRateLimit(){var e;let t=this.limitUntil;if(t>Date.now()){null==(e=this.abortDelayController)||e.abort(),this.abortDelayController=new U;let r=this.getRateLimitDelay(t-Date.now());await this.delay(r,this.abortDelayController),this.drained=!1,this.limitUntil=0}}async mainLoop(){let e=new nM,t=0;for(;!this.closing&&!this.paused||e.numTotal()>0;){let r;for(;!this.closing&&!this.paused&&!this.waiting&&e.numTotal()<this._concurrency&&!this.isRateLimited();){let r=`${this.id}:${t++}`,n=this.retryIfFailed(()=>this._getNextJob(r,{block:!0}),{delayInMs:this.opts.runRetryDelay,onlyEmitError:!0});if(e.add(n),this.waiting&&e.numTotal()>1||!await n&&e.numTotal()>1||this.blockUntil)break}do r=await e.fetch();while(!r&&e.numQueued()>0)if(r){let t=r.token;e.add(this.processJob(r,t,()=>e.numTotal()<=this._concurrency))}else 0===e.numQueued()&&await this.waitForRateLimit()}}async getNextJob(e,{block:t=!0}={}){var r,n;let i=await this._getNextJob(e,{block:t});return this.trace(k.INTERNAL,"getNextJob",this.name,async e=>(null==e||e.setAttributes({[w.WorkerId]:this.id,[w.QueueName]:this.name,[w.WorkerName]:this.opts.name,[w.WorkerOptions]:JSON.stringify({block:t}),[w.JobId]:null==i?void 0:i.id}),i),null==(n=null==(r=null==i?void 0:i.opts)?void 0:r.telemetry)?void 0:n.metadata)}async _getNextJob(e,{block:t=!0}={}){let r;if(!this.paused&&!this.closing){if(this.drained&&t&&!this.limitUntil&&!this.waiting){this.waiting=this.waitForJob(this.blockUntil);try{this.blockUntil=await this.waiting,(this.blockUntil<=0||this.blockUntil-Date.now()<1)&&(r=await this.moveToActive(e,this.opts.name))}finally{this.waiting=null}}else this.isRateLimited()||(r=await this.moveToActive(e,this.opts.name));return r}}async rateLimit(e){await this.trace(k.INTERNAL,"rateLimit",this.name,async t=>{null==t||t.setAttributes({[w.WorkerId]:this.id,[w.WorkerRateLimit]:e}),await this.backend.setRateLimit(e)})}get minimumBlockTimeout(){return this.backend.minimumBlockTimeout}get maximumBlockTimeout(){var e;return null!=(e=this.backend.maximumBlockTimeout)?e:10}isRateLimited(){return this.limitUntil>Date.now()}async moveToActive(e,t){let[r,n,i,a]=await this.backend.moveToActive(e,t);return this.updateDelays(i,a),this.nextJobFromJobData(r,n,e)}async waitForJob(e){if(this.paused)return 1/0;try{if(!this.closing&&!this.isRateLimited()){let t=this.getBlockTimeout(e);if(t>0){this.updateDelays();let r=await this.backend.waitForJob(t);if(r){let t=r.score;if(e&&t>e)return e;return t}}return 0}}catch(e){if(ef(e)&&this.emit("error",e),!this.closing)try{await this.backend.reconnectBlocking()}catch(e){ef(e)&&this.emit("error",e)}this.closing||await this.delay()}return 1/0}getBlockTimeout(e){let t=this.opts;if(!e)return Math.max(t.drainDelay,this.minimumBlockTimeout);{let t=e-Date.now();return t<=0?t:t<1e3*this.minimumBlockTimeout?this.minimumBlockTimeout:Math.min(t/1e3,this.maximumBlockTimeout)}}getRateLimitDelay(e){return Math.min(e,this.opts.maximumRateLimitDelay)}async delay(e,t){await ei(e||100,t)}updateDelays(e=0,t=0){let r=Math.max(e,0);r>0?this.limitUntil=Date.now()+r:this.limitUntil=0,this.blockUntil=Math.max(t,0)||0}async nextJobFromJobData(e,t,r){if(e){this.drained=!1;let n=this.createJob(e,t);n.token=r;try{let e=await this.retryIfFailed(async()=>{let e=!!n.repeatJobKey,t=e&&ng(n.repeatJobKey),r=e&&!t;if(t){let e=await this.jobScheduler;r=await e.isJobScheduler(n.repeatJobKey)}if(r){let e=await this.jobScheduler;await e.upsertJobScheduler(n.repeatJobKey,n.opts.repeat,n.name,n.data,n.opts,{override:!1,producerId:n.id})}return!t||r},{delayInMs:this.opts.runRetryDelay});if(n.repeatJobKey&&!e){let e=Error(`Failed to add repeatable job for next iteration: ${nK(n.repeatJobKey).message}`);this.emit("error",e)}}catch(r){let e=r instanceof Error?r.message:String(r),t=Error(`Failed to add repeatable job for next iteration: ${e}`);this.emit("error",t);return}return this.emit("active",n,"waiting"),n}this.drained||(this.emit("drained"),this.drained=!0)}async processJob(e,t,r=()=>!0){var n,i;let a=null==(i=null==(n=e.opts)?void 0:n.telemetry)?void 0:i.metadata;return this.trace(k.CONSUMER,"process",this.name,async n=>{null==n||n.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name,[w.JobId]:e.id,[w.JobName]:e.name});let i=this.lockManager.trackJob(e.id,t,e.processedOn,this.processorAcceptsSignal);try{let a=this.getUnrecoverableErrorMessage(e);if(a)return await this.retryIfFailed(()=>(this.lockManager.untrackJob(e.id),this.handleFailed(new tJ(a),e,t,r,n)),{delayInMs:this.opts.runRetryDelay,span:n});let s=await this.callProcessJob(e,t,i?i.signal:void 0);return await this.retryIfFailed(()=>(this.lockManager.untrackJob(e.id),this.handleCompleted(s,e,t,r,n)),{delayInMs:this.opts.runRetryDelay,span:n})}catch(i){return await this.retryIfFailed(()=>(this.lockManager.untrackJob(e.id),this.handleFailed(i,e,t,r,n)),{delayInMs:this.opts.runRetryDelay,span:n,onlyEmitError:!0})}finally{this.lockManager.untrackJob(e.id);let t=Date.now();null==n||n.setAttributes({[w.JobAttemptFinishedTimestamp]:e.finishedOn||t,[w.JobProcessedTimestamp]:e.processedOn})}},a)}getUnrecoverableErrorMessage(e){return e.deferredFailure?e.deferredFailure:this.opts.maxStartedAttempts&&this.opts.maxStartedAttempts<e.attemptsStarted?"job started more than allowable limit":void 0}async handleCompleted(e,t,r,n=()=>!0,i){if(!this.backend.closing){let a=await t.moveToCompleted(e,r,n()&&!(this.closing||this.paused));if(this.emit("completed",t,e,"active"),null==i||i.addEvent("job completed",{[w.JobResult]:JSON.stringify(e)}),null==i||i.setAttributes({[w.JobAttemptsMade]:t.attemptsMade}),Array.isArray(a)){let[e,t,n,i]=a;return this.updateDelays(n,i),this.nextJobFromJobData(e,t,r)}}}async handleFailed(e,t,r,n=()=>!0,i){if(!this.backend.closing){if(e.message===nJ){let e=await this.moveLimitedBackToWait(t,r);this.limitUntil=e>0?Date.now()+e:0;return}let a=n()&&!(this.closing||this.paused);if(e instanceof nP||"DelayedError"==e.name||e instanceof n_||"WaitingError"==e.name||e instanceof nF||"WaitingChildrenError"==e.name){if(!a)return;return this.moveToActive(r,this.opts.name)}let s=await t.moveToFailed(e,r,a);if(this.emit("failed",t,e,"active"),null==i||i.addEvent("job failed",{[w.JobFailedReason]:e.message}),null==i||i.setAttributes({[w.JobAttemptsMade]:t.attemptsMade}),Array.isArray(s)){let[e,t,n,i]=s;return this.updateDelays(n,i),this.nextJobFromJobData(e,t,r)}}}async pause(e){await this.trace(k.INTERNAL,"pause",this.name,async t=>{var r;null==t||t.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name,[w.WorkerDoNotWaitActive]:e}),this.paused||(this.paused=!0,e||await this.whenCurrentJobsFinished(),null==(r=this.stalledCheckStopper)||r.call(this),this.emit("paused"))})}async resume(){try{(!this.running||this.paused)&&await this.trace(k.INTERNAL,"resume",this.name,async e=>{null==e||e.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name}),this.paused=!1,this.running?await this.startStalledCheckTimer():this.processFn&&this.run(),this.emit("resumed")})}catch(e){this.emit("error",e)}}isPaused(){return!!this.paused}isRunning(){return this.running}async close(e=!1){return this.closing?this.closing:(this.closing=(async()=>{await this.trace(k.INTERNAL,"close",this.name,async t=>{var r,n;for(let n of(null==t||t.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name,[w.WorkerForceClose]:e}),this.emit("closing","closing queue"),null==(r=this.abortDelayController)||r.abort(),[()=>e||this.whenCurrentJobsFinished(!1),()=>this.lockManager.close(),()=>{var e;return null==(e=this.childPool)?void 0:e.clean()},()=>this.backend.close(e)]))try{await n()}catch(e){this.emit("error",e)}null==(n=this.stalledCheckStopper)||n.call(this),this.closed=!0,this.emit("closed")})})(),await this.closing)}async startStalledCheckTimer(){this.opts.skipStalledCheck||this.closing||this.stalledCheckerRunning||await this.trace(k.INTERNAL,"startStalledCheckTimer",this.name,async e=>{null==e||e.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name}),this.stalledCheckerRunning=!0,this.stalledChecker().catch(e=>{this.emit("error",e)}).finally(()=>{this.stalledCheckerRunning=!1})})}async stalledChecker(){for(;!(this.closing||this.paused);)await this.checkConnectionError(()=>this.moveStalledJobsToWait()),await new Promise(e=>{let t=setTimeout(e,this.opts.stalledInterval);this.stalledCheckStopper=()=>{clearTimeout(t),e()}})}async whenCurrentJobsFinished(e=!0){this.mainLoopRunning?(await this.backend.disconnectBlocking(!0),await this.mainLoopRunning):e=!1,e&&await this.backend.reconnectBlocking()}async retryIfFailed(e,t){var r;let n=0,i=t.maxRetries||1/0;do try{return await e()}catch(e){if(null==(r=t.span)||r.recordException(e.message),ef(e)){if(this.paused||this.closing||this.emit("error",e),t.onlyEmitError)return;throw e}if(!t.delayInMs||this.closing||this.closed||await this.delay(t.delayInMs,this.abortDelayController),n+1>=i)throw e}while(++n<i)}async moveStalledJobsToWait(){await this.trace(k.INTERNAL,"moveStalledJobsToWait",this.name,async e=>{let t=await this.backend.moveStalledJobsToWait();null==e||e.setAttributes({[w.WorkerId]:this.id,[w.WorkerName]:this.opts.name,[w.WorkerStalledJobs]:t}),t.forEach(t=>{null==e||e.addEvent("job stalled",{[w.JobId]:t}),this.emit("stalled",t,"active")})})}moveLimitedBackToWait(e,t){return e.moveToWait(t)}}e.s(["Worker",0,nG],30481),e.s([],61119),(g=N||(N={})).blocking="blocking",g.normal="normal",e.s(["ClientType",0,N],88639),e.s([],33977);var nY=q;function n$(e){return!!e&&"function"==typeof e.connect&&"function"==typeof e.query&&"function"==typeof e.end}let nW="/ROOT/node_modules/bullmq/dist/esm/postgres",nU=(0,Y.join)(nW,"migrations"),nz=(0,Y.join)(nW,"commands"),nH=new Map,nB=new Map;function nZ(e){let t=nH.get(e);return void 0===t&&(t=(0,nT.readFileSync)((0,Y.join)(nU,e),"utf8"),nH.set(e,t)),t}function nX(e){let t=nB.get(e);return void 0===t&&(t=(0,nT.readFileSync)((0,Y.join)(nz,`${e}.sql`),"utf8"),nB.set(e,t)),t}let nQ=[{version:1,name:"0001_schema",minClientVersion:6,load:()=>nZ("0001_schema.sql")},{version:2,name:"0002_functions",minClientVersion:6,load:()=>nZ("0002_functions.sql")}],n0=nQ.length>0?nQ[nQ.length-1].version:0,n1="bullmq",n2=parseInt(tN.split(".")[0],10);class n3 extends Error{constructor(e,t){super(`BullMQ: the PostgreSQL backend requires server version ${t} or newer, but the server reports ${e}. Upgrade PostgreSQL, or pass \`skipVersionCheck: true\` on the connection to bypass this check at your own risk.`),this.serverVersion=e,this.minimumVersion=t,this.name="UnsupportedPostgresVersionError"}}async function n4(e,t=!1){var r,n,i,a;if(t)return;let{rows:s}=await e.query("SELECT current_setting('server_version_num') AS num, current_setting('server_version') AS ver");ia(null!=(n=null==(r=s[0])?void 0:r.num)?n:"0",null!=(a=null==(i=s[0])?void 0:i.ver)?a:"unknown")}function n6(e){if(!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(e)||e.length>63)throw Error(`BullMQ: invalid PostgreSQL schema name ${JSON.stringify(e)}. Use a simple identifier (letters, digits, underscores; max 63 chars).`);return`"${e}"`}class n5 extends Error{constructor(e,t){super(`BullMQ: the PostgreSQL schema requires BullMQ major version ${e} or newer, but this client is major version ${t}. Upgrade BullMQ to use this schema.`),this.minimumClientVersion=e,this.clientVersion=t,this.name="SchemaVersionMismatchError",this.databaseVersion=e,this.supportedVersion=t}}class n8 extends Error{constructor(e){super(`BullMQ: PostgreSQL schema ${JSON.stringify(e)} is not initialized. Run the migrations explicitly or pass \`migrate: true\` on the connection.`),this.schema=e,this.name="SchemaMigrationRequiredError"}}async function n9(e,t=n1,r={}){var n,i,a,s;let o,l=n6(t);try{({rows:o}=await e.query(`SELECT COALESCE(MAX(version), 0)::int AS version,
              COALESCE(
                MAX((to_jsonb(migration)->>'min_client_version')::int),
                $1
              )::int AS min_client_version,
              current_setting('server_version_num') AS server_version_num,
              current_setting('server_version') AS server_version
         FROM ${l}.migration`,[n2]))}catch(e){if("42P01"===e.code)throw new n8(t);throw e}let d=o[0];r.skipVersionCheck||ia(null!=(n=null==d?void 0:d.server_version_num)?n:"0",null!=(i=null==d?void 0:d.server_version)?i:"unknown");let c=null!=(a=null==d?void 0:d.min_client_version)?a:n2;if(c>n2)throw new n5(c,n2);return null!=(s=null==d?void 0:d.version)?s:0}async function n7(e,t=n1,r={}){let n=n6(t);await n4(e,r.skipVersionCheck),await e.query("BEGIN");try{await e.query("SELECT pg_advisory_xact_lock($1, hashtext($2))",[0x42554c4c,t]),await e.query(`CREATE SCHEMA IF NOT EXISTS ${n}`),await e.query(`SET LOCAL search_path TO ${n}`),await it(e);let r=await ie(e),i=await ir(e);if(i>n2)throw new n5(i,n2);if(r<n0)for(let t of nQ)t.version>r&&await ii(e,t);return await e.query("COMMIT"),Math.max(r,n0)}catch(t){throw await e.query("ROLLBACK"),t}}async function ie(e){var t,r;let{rows:n}=await e.query("SELECT COALESCE(MAX(version), 0)::int AS version FROM migration");return null!=(r=null==(t=n[0])?void 0:t.version)?r:0}async function it(e){await e.query(`CREATE TABLE IF NOT EXISTS migration (
       version    integer PRIMARY KEY,
       name       text NOT NULL,
       min_client_version integer NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`),await e.query("ALTER TABLE migration ADD COLUMN IF NOT EXISTS min_client_version integer"),await e.query("UPDATE migration SET min_client_version = $1 WHERE min_client_version IS NULL",[n2]),await e.query("ALTER TABLE migration ALTER COLUMN min_client_version SET NOT NULL")}async function ir(e){var t,r;let{rows:n}=await e.query(`SELECT COALESCE(MAX(min_client_version), $1)::int AS min_client_version
       FROM migration`,[n2]);return null!=(r=null==(t=n[0])?void 0:t.min_client_version)?r:n2}async function ii(e,t){await e.query(t.load()),await e.query(`INSERT INTO migration (version, name, min_client_version)
     VALUES ($1, $2, $3)`,[t.version,t.name,t.minClientVersion])}function ia(e,t){let r=Math.floor(parseInt(e,10)/1e4);if(r<13)throw new n3(t,13);r<14&&(n4._warnedRecommendedVersion||(n4._warnedRecommendedVersion=!0,console.warn(`BullMQ: PostgreSQL 14 or newer is recommended for the PostgreSQL backend (detected ${t}).`)))}class is extends nY.EventEmitter{constructor(e){var t;if(super(),this.listenClientIsStandalone=!1,n$(e))this.pool=e,this.ownsPool=!1,this.schema=n1,this.skipVersionCheck=!1,this.migrateOnConnect=!1,this.pgModule=void 0,this.listenClientConfig=void 0,this.listenClientKeepAlive=!!(null==(t=e.options)?void 0:t.keepAlive);else{const t=function(){try{let e=Error("Cannot find module 'pg'");throw e.code="MODULE_NOT_FOUND",e}catch(e){}throw Error("The PostgreSQL backend could not load the optional 'pg' package. Install it with `npm install pg`. In a native ESM environment, pass an already-constructed `pg.Pool` instance as the connection instead of a config object or connection string.")}(),r="string"==typeof e?{schema:void 0,skipVersionCheck:void 0,migrate:void 0,skipMigrations:void 0,connectionString:e}:e,{schema:n,skipVersionCheck:i,migrate:a,skipMigrations:s}=r,o=(0,tU.__rest)(r,["schema","skipVersionCheck","migrate","skipMigrations"]);if(void 0!==a&&void 0!==s)throw Error("BullMQ: `migrate` and `skipMigrations` are mutually exclusive. Set only one.");this.schema=null!=n?n:n1,this.skipVersionCheck=null!=i&&i,this.migrateOnConnect=null!=a?a:void 0!==s&&!s;const l=n6(this.schema),d=`-c search_path=${l}`,c=o.options,u=Object.assign(Object.assign({},o),{options:c?`${c} ${d}`:d});this.pool=new t.Pool(u),this.ownsPool=!0,this.pgModule=t,this.listenClientConfig=u,this.listenClientKeepAlive=!0}this.pool.on("error",e=>this.emitError(e))}emitError(e){this.listenerCount("error")>0&&this.emit("error",e)}async waitUntilReady(){return this.readyPromise||(this.readyPromise=this.bootstrap()),this.readyPromise}async bootstrap(){let e=await this.pool.connect();try{this.migrateOnConnect?await n7(e,this.schema,{skipVersionCheck:this.skipVersionCheck}):await n9(e,this.schema,{skipVersionCheck:this.skipVersionCheck})}finally{e.release()}setTimeout(()=>this.emit("ready"),0)}async getListenClient(){return this.listenClientPromise||(this.listenClientPromise=(async()=>{if(this.pgModule&&this.listenClientConfig){let e=new this.pgModule.Client(Object.assign(Object.assign({},this.listenClientConfig),{keepAlive:!0,keepAliveInitialDelayMillis:1e4}));return await e.connect(),e.on("error",t=>this.handleListenClientError(e,t)),this.listenClientKeepAlive=!0,this.listenClientIsStandalone=!0,this.listenClient=e,await this.applyListenClientName(e),e}{let e=await this.pool.connect();return e.on("error",t=>this.handleListenClientError(e,t)),this.listenClientKeepAlive=this.listenClientKeepAlive||function(e){var t;let r=null==(t=e.connection)?void 0:t.stream;if(!r||"function"!=typeof r.setKeepAlive)return!1;try{return r.setKeepAlive(!0,1e4),!0}catch(e){return!1}}(e),this.listenClientIsStandalone=!1,this.listenClient=e,await this.applyListenClientName(e),e}})()),this.listenClientPromise}get hasListenClientKeepAlive(){return this.listenClientKeepAlive}async setListenClientName(e){this.listenClientName=e;let t=await this.getListenClient();await t.query("SELECT set_config('application_name', $1, false)",[e])}async applyListenClientName(e){if(this.listenClientName)try{await e.query("SELECT set_config('application_name', $1, false)",[this.listenClientName])}catch(e){}}handleListenClientError(e,t){if(this.listenClient===e&&!this.closing){let t=this.listenClientIsStandalone;this.listenClient=void 0,this.listenClientPromise=void 0,e.removeAllListeners("notification");try{t?e.end().catch(()=>void 0):e.release(!0)}catch(e){}this.emit("listenerinvalidated")}this.emitError(t)}get isClosing(){return this.closing}async close(){return this.closing||(this.closing=(async()=>{var e,t;let r=null!=(e=this.listenClient)?e:await (null==(t=this.listenClientPromise)?void 0:t.catch(()=>void 0));this.listenClientPromise=void 0,r&&(r.removeAllListeners(),this.listenClientIsStandalone?await r.end():r.release(),this.listenClient=void 0),this.ownsPool&&await this.pool.end(),this.emit("close")})()),this.closing}async disconnect(){return this.close()}}var io=q;function il(e){return null==e?void 0:Number(e)}function id(e){var t,r;return!0===e?{removeAll:!0,keepAge:null,keepCount:null}:!1===e||null==e?{removeAll:!1,keepAge:null,keepCount:null}:"number"==typeof e?{removeAll:!1,keepAge:null,keepCount:e}:{removeAll:!1,keepAge:null!=(t=e.age)?t:null,keepCount:null!=(r=e.count)?r:null}}function ic(e){var t,r,n,i,a,s,o,l,d,c,u,h,p,m,y,f,b={id:e.id,name:e.name,data:JSON.stringify(null!=(t=e.data)?t:{}),opts:null!=(r=e.opts)?r:{},progress:null!=(n=e.progress)?n:0,attemptsMade:null!=(i=e.attempts_made)?i:0,attemptsStarted:null!=(a=e.attempts_started)?a:0,finishedOn:il(e.finished_at_ms),processedOn:il(e.processed_at_ms),timestamp:Number(e.added_at_ms),delay:il(e.delay_ms),priority:null!=(s=e.priority)?s:void 0,failedReason:null!=(o=e.failed_reason)?o:void 0,stacktrace:JSON.stringify(null!=(l=e.stacktrace)?l:[]),returnvalue:JSON.stringify(null!=(d=e.return_value)?d:null),parent:null!=e.parent_id?{id:e.parent_id,queueKey:null!=(c=e.parent_queue)?c:""}:void 0,parentKey:null!=(u=e.parent_key)?u:void 0,repeatJobKey:null!=(h=e.scheduler_id)?h:void 0,deduplicationId:null!=(p=e.dedup_id)?p:void 0,deferredFailure:null!=(m=e.deferred_failure)?m:void 0,processedBy:null!=(y=e.processed_by)?y:void 0,stalledCounter:null!=(f=e.stalled_count)?f:0};for(let e of Object.keys(b))void 0===b[e]&&delete b[e];return b}function iu(e){throw Error(`PostgresQueueBackend: operation '${e}' is not implemented yet.`)}function ih(e){let t={};if(null!=e.name&&(t.name=String(e.name)),null!=e.iteration_count&&(t.ic=String(e.iteration_count)),null!=e.limit_count&&(t.limit=String(e.limit_count)),null!=e.start_date_ms&&(t.startDate=String(e.start_date_ms)),null!=e.end_date_ms&&(t.endDate=String(e.end_date_ms)),null!=e.tz&&(t.tz=String(e.tz)),null!=e.pattern&&(t.pattern=String(e.pattern)),null!=e.every_ms&&(t.every=String(e.every_ms)),null!=e.offset_ms&&(t.offset=String(e.offset_ms)),null!=e.template_data){let r=JSON.stringify(e.template_data);"{}"!==r&&(t.data=r)}if(null!=e.template_opts){let r=JSON.stringify(e.template_opts);"{}"!==r&&(t.opts=r)}return{hash:t,next:null==e.next_run_ms?null:String(e.next_run_ms)}}class ip extends io.EventEmitter{constructor(e,t,r,n=!0,i){super(),this.connection=e,this.queueName=t,this.opts=r,this.ownsConnection=n,this.listenClientName=i,this.listening=!1,this.listeningEvents=!1,this.blockingDisconnected=!1,this.schema=e.schema,this.ownsConnection&&(this.connection.on("error",e=>this.emit("error",e)),this.connection.on("ready",()=>this.emit("ready")),this.connection.on("close",()=>this.emit("close")),this.connection.on("listenerinvalidated",()=>{var e,t;this.listening=!1,this.listeningEvents=!1,null==(e=this.cancelWait)||e.call(this),null==(t=this.cancelEventWait)||t.call(this)}))}async waitUntilReady(){return this.readyPromise||(this.readyPromise=(async()=>{if(await this.connection.waitUntilReady(),this.listenClientName)try{await this.setName(this.listenClientName)}catch(e){}})()),this.readyPromise}async close(e=!1){if(this.ownsConnection)return this.closing||(this.closing=this.connection.close()),this.closing}async disconnect(){var e,t;null==(e=this.cancelWait)||e.call(this),null==(t=this.cancelEventWait)||t.call(this),this.ownsConnection&&await this.connection.disconnect()}async setName(e){await this.connection.waitUntilReady(),await this.connection.setListenClientName(e)}get minimumBlockTimeout(){return .001}get maximumBlockTimeout(){return this.connection.hasListenClientKeepAlive?3600:10}forQueue(e,t){return new ip(this.connection,e,this.opts,!1)}get qualifiedName(){return this.queueName}get keys(){return{}}toKey(e){return`${this.queueName}:${e}`}parseNodeKey(e){let t=e.lastIndexOf(":");return{prefix:"",queueName:e.slice(0,t),id:e.slice(t+1)}}clientName(e=""){return`${this.queueName}${e}`}async query(e,t){if(await this.connection.waitUntilReady(),this.connection.isClosing)return new Promise(()=>void 0);try{return await this.connection.pool.query(e,t)}catch(e){if(this.connection.isClosing&&e instanceof Error&&e.message.includes("after calling end on the pool"))return new Promise(()=>void 0);throw e}}run(e,t){return this.query(nX(e),t)}get workerName(){return this.opts.name}mapFinishError(e,t,r){if(e&&"BM001"===e.code)throw tL({code:Number(e.detail),jobId:t,command:r,state:"active"});throw e}async addJob(e,t,r={}){var n,i,a,s,o,l,d,c,u,h,p,m,y,f,b,g,K;let v,E=null!=(n=e.opts)?n:{},I=null!=(a=null!=(i=r.parentKey)?i:e.parentKey)?a:null;try{({rows:v}=await this.run("add_job",[this.queueName,t||e.id||"",e.name,null!=(s=e.data)?s:"{}",JSON.stringify(null!=E?E:{}),null!=(l=null!=(o=e.priority)?o:E.priority)?l:0,null!=(c=null!=(d=e.delay)?d:E.delay)?c:0,null!=(u=e.timestamp)?u:Date.now(),null!=(h=E.attempts)?h:1,null!=(m=null==(p=e.parent)?void 0:p.queueKey)?m:null,null!=(f=null==(y=e.parent)?void 0:y.id)?f:null,I,null!=(b=e.deduplicationId)?b:null,null!=(g=e.repeatJobKey)?g:null,null!=(K=E.lifo)&&K]))}catch(e){if(e&&"BM001"===e.code)throw tL({code:Number(e.detail),jobId:t,parentKey:null!=I?I:void 0,command:"addJob"});throw e}return v[0].id}async addJobs(e){let t=e.map(e=>this.toBatchEntry(this.queueName,e.job,e.jobId,e.parentKeyOpts));if(t.every(e=>null==e.parentId&&null==e.parentQueue&&null==e.dedupId)){let{rows:e}=await this.run("add_jobs_bulk",[this.queueName,JSON.stringify(t)]);return e.map(e=>e.id)}let{rows:r}=await this.run("add_flow",[JSON.stringify(t)]);return r.map(e=>e.id)}toBatchEntry(e,t,r,n){var i,a,s,o,l,d,c,u,h,p,m,y,f,b,g,K,v,E;let I=null!=(i=t.opts)?i:{};return{queue:e,id:r||t.id||"",name:t.name,data:null!=(a=t.data)?a:"{}",opts:I,priority:null!=(o=null!=(s=t.priority)?s:I.priority)?o:0,delay:null!=(d=null!=(l=t.delay)?l:I.delay)?d:0,timestamp:null!=(c=t.timestamp)?c:Date.now(),attempts:null!=(u=I.attempts)?u:1,parentQueue:null!=(p=null==(h=t.parent)?void 0:h.queueKey)?p:null,parentId:null!=(y=null==(m=t.parent)?void 0:m.id)?y:null,parentKey:null!=(b=null!=(f=null==n?void 0:n.parentKey)?f:t.parentKey)?b:null,dedupId:null!=(g=t.deduplicationId)?g:null,schedulerId:null!=(K=t.repeatJobKey)?K:null,lifo:null!=(v=I.lifo)&&v,addToWaitingChildren:null!=(E=null==n?void 0:n.addToWaitingChildren)&&E}}async addFlow(e){let t=e.map(e=>this.toBatchEntry(e.queueName,e.jobData,e.jobId,e.parentKeyOpts));try{let{rows:e}=await this.run("add_flow",[JSON.stringify(t)]);return e.map(e=>{let t=Number(e.id);return Number.isInteger(t)&&t<0?[null,t]:[null,e.id]})}catch(t){return e.map(()=>[t,0])}}async addJobScheduler(e,t,r,n,i,a,s){let o;try{({rows:o}=await this.run("add_job_scheduler",[this.queueName,e,null!=t?t:null,r||"{}",JSON.stringify(null!=n?n:{}),JSON.stringify(null!=i?i:{}),JSON.stringify(null!=a?a:{}),Date.now(),null!=s?s:null]))}catch(e){if(e&&"BM001"===e.code)throw tL({code:Number(e.detail),command:"addJobScheduler"});throw e}let l=o[0];return[l.job_id,Number(l.delay)]}async moveToActive(e,t){var r,n,i,a,s;let o=this.opts,l=null!=(r=o.lockDuration)?r:3e4,d=null!=(i=null==(n=o.limiter)?void 0:n.max)?i:null,c=null!=(s=null==(a=o.limiter)?void 0:a.duration)?s:null,u=Date.now(),{rows:h}=await this.run("move_to_active",[this.queueName,e,l,u,null!=t?t:null,d,c]);return this.buildNextJobResult(h,d,u)}async buildNextJobResult(e,t,r){var n,i,a,s,o;if(e.length>0){let t=e[0];return[ic(t),t.id,0,0]}let{rows:l}=await this.run("next_signal",[this.queueName,t,r]),d=Number(null!=(i=null==(n=l[0])?void 0:n.rate_limit_ttl)?i:0);return d>0?[null,"",d,0]:[null,"",0,null!=(o=il(null!=(s=null==(a=l[0])?void 0:a.next_delay)?s:null))?o:0]}async moveToCompleted(e,t,r,n,i){var a,s,o,l,d,c;let u=Date.now(),h=id(null!=r?r:this.opts.removeOnComplete),p=this.opts;if(i&&!this.closing){let r=null!=(a=p.lockDuration)?a:3e4,i=null!=(o=null==(s=p.limiter)?void 0:s.max)?o:null,m=null!=(d=null==(l=p.limiter)?void 0:l.duration)?d:null,y=Date.now(),f=[];try{({rows:f}=await this.run("move_to_completed_fetch",[this.queueName,e.id,n,JSON.stringify(null!=t?t:null),u,h.removeAll,h.keepAge,h.keepCount,r,y,null!=(c=this.workerName)?c:null,i,m]))}catch(t){this.mapFinishError(t,e.id,"moveToFinished")}return await this.collectMetrics("completed",u),{result:await this.buildNextJobResult(f,i,y),finishedOn:u}}try{await this.run("move_to_completed",[this.queueName,e.id,n,JSON.stringify(null!=t?t:null),u,h.removeAll,h.keepAge,h.keepCount])}catch(t){this.mapFinishError(t,e.id,"moveToFinished")}return await this.collectMetrics("completed",u),{result:void 0,finishedOn:u}}async moveToFailed(e,t,r,n,i,a){var s,o,l,d,c,u,h,p;let m=Date.now(),y=id(null!=r?r:this.opts.removeOnFail),f=this.opts;if(i&&!this.closing){let r=null!=(s=f.lockDuration)?s:3e4,i=null!=(l=null==(o=f.limiter)?void 0:o.max)?l:null,p=null!=(c=null==(d=f.limiter)?void 0:d.duration)?c:null,b=Date.now(),g=[];try{({rows:g}=await this.run("move_to_failed_fetch",[this.queueName,e.id,n,t,null!=(u=null==a?void 0:a.stacktrace)?u:null,m,y.removeAll,y.keepAge,y.keepCount,r,b,null!=(h=this.workerName)?h:null,i,p]))}catch(t){this.mapFinishError(t,e.id,"moveToFinished")}return await this.collectMetrics("failed",m),{result:await this.buildNextJobResult(g,i,b),finishedOn:m}}try{await this.run("move_to_failed",[this.queueName,e.id,n,t,null!=(p=null==a?void 0:a.stacktrace)?p:null,m,y.removeAll,y.keepAge,y.keepCount])}catch(t){this.mapFinishError(t,e.id,"moveToFinished")}return await this.collectMetrics("failed",m),{result:void 0,finishedOn:m}}async moveToDelayed(e,t,r,n,i){var a,s,o,l;let d=null!=(a=null==i?void 0:i.fieldsToUpdate)?a:{};try{await this.run("move_to_delayed",[this.queueName,e,null!=n?n:"",t+r,r,null!=(s=null==i?void 0:i.skipAttempt)&&s,null!=(o=d.failedReason)?o:null,null!=(l=d.stacktrace)?l:null])}catch(t){this.mapFinishError(t,e,"moveToDelayed")}if((null==i?void 0:i.fetchNext)&&!this.closing&&n){let e=await this.moveToActive(n,this.workerName);return e&&e[0]?e:[]}return[]}async moveToWaitingChildren(e,t,r){let n;try{({rows:n}=await this.run("move_to_waiting_children",[this.queueName,e,t]))}catch(t){this.mapFinishError(t,e,"moveToWaitingChildren")}let i=n[0].code;if(i<0)throw tL({code:i,jobId:e,command:"moveToWaitingChildren",state:"active"});return 1===i}async moveJobFromActiveToWait(e,t="0"){let{rows:r}=await this.run("move_active_to_wait",[this.queueName,e,t,Date.now()]),n=Number(r[0].n);if(n<0)throw tL({code:n,jobId:e,command:"moveJobFromActiveToWait"});return n}async retryJob(e,t,r,n){var i,a,s;let o=null!=(i=null==n?void 0:n.fieldsToUpdate)?i:{};try{await this.run("retry_job",[this.queueName,e,null!=r?r:"",t,null!=(a=o.failedReason)?a:null,null!=(s=o.stacktrace)?s:null])}catch(t){this.mapFinishError(t,e,"retryJob")}}async retryFinishedJob(e,t,r={}){var n,i,a,s;let{rows:o}=await this.run("reprocess_job",[this.queueName,e.id,t,null!=(i=null==(n=e.opts)?void 0:n.lifo)&&i,null!=(a=r.resetAttemptsMade)&&a,null!=(s=r.resetAttemptsStarted)&&s]),l=o[0].code;if(1!==l)throw tL({code:l,jobId:e.id,command:"reprocessJob",state:t})}async promote(e){let{rows:t}=await this.run("promote",[this.queueName,e]),r=t[0].code;if(r<0)throw tL({code:r,jobId:e,command:"promote",state:"delayed"})}async moveStalledJobsToWait(){var e,t;let r=this.opts,{rows:n}=await this.run("move_stalled_jobs_to_wait",[this.queueName,null!=(e=r.maxStalledCount)?e:1,Date.now(),null!=(t=r.stalledInterval)?t:3e4]);return n.map(e=>e.id)}async retryFinishedJobs(e,t,r){let{rows:n}=await this.run("retry_jobs",[this.queueName,null!=e?e:"failed",null!=t?t:null,null!=r?r:null]);return Number(n[0].n)}async promoteJobs(e){let{rows:t}=await this.run("promote_jobs",[this.queueName,null!=e?e:null]);return Number(t[0].n)}async pause(e){await this.run("pause",[this.queueName,e])}async drain(e){await this.run("drain",[this.queueName,e])}async cleanJobsByState(e,t,r=0){let{rows:n}=await this.run("clean",[this.queueName,e,t,r]);return n.map(e=>e.id)}async obliterate(e){let{rows:t}=await this.run("obliterate",[this.queueName,e.count,e.force]),r=Number(t[0].cursor);if(r<0)switch(r){case -1:throw Error("Cannot obliterate non-paused queue");case -2:throw Error("Cannot obliterate queue with active jobs")}return r}removeOrphanedJobs(e,t){return Promise.resolve(0)}async extendLock(e,t,r){let{rows:n}=await this.run("extend_lock",[this.queueName,e,t,r,Date.now()]);return n[0].n}async extendLocks(e,t,r){let{rows:n}=await this.run("extend_locks",[this.queueName,e,t,r,Date.now()]);return n.map(({id:e})=>e)}async updateData(e,t){let{rows:r}=await this.run("update_data",[this.queueName,e.id,JSON.stringify(null!=t?t:{})]);if(0===r.length)throw tL({code:-1,jobId:e.id,command:"updateData"})}async updateProgress(e,t){let{rows:r}=await this.run("update_progress",[this.queueName,e,JSON.stringify(null!=t?t:null)]);if(!r[0].updated)throw tL({code:-1,jobId:e,command:"updateProgress"})}async addLog(e,t,r){let n;try{({rows:n}=await this.run("add_log",[this.queueName,e,t]))}catch(t){if(t&&"23503"===t.code)throw tL({code:-1,jobId:e,command:"addLog"});throw t}let i=Number(n[0].idx)+1;return r&&i>r?(await this.run("trim_logs",[this.queueName,e,i-r]),r):i}async clearLogs(e,t){await this.run("clear_logs",[this.queueName,e,null!=t?t:null])}async changeDelay(e,t){let{rows:r}=await this.run("change_delay",[this.queueName,e,t,Date.now()]),n=r[0].code;if(n<0)throw tL({code:n,jobId:e,command:"changeDelay",state:"delayed"})}async changePriority(e,t=0,r=!1){let{rows:n}=await this.run("change_priority",[this.queueName,e,t,r]),i=n[0].code;if(i<0)throw tL({code:i,jobId:e,command:"changePriority"})}async remove(e,t){let r;try{({rows:r}=await this.run("remove",[this.queueName,e,t]))}catch(t){if(t&&"BM001"===t.code)throw tL({code:Number(t.detail),jobId:e,command:"remove"});throw t}return r[0].n}async removeUnprocessedChildren(e){await this.run("remove_unprocessed_children",[this.queueName,e])}async removeChildDependency(e,t){try{let{rows:r}=await this.run("remove_child_dependency",[this.queueName,e,t,Date.now()]);return 0===r[0].n}catch(r){if(r&&"BM001"===r.code)throw tL({code:Number(r.detail),jobId:e,parentKey:t,command:"removeChildDependency"});throw r}}async removeDeduplicationKey(e,t){let{rows:r}=await this.run("remove_deduplication_key",[this.queueName,e,t,Date.now()]);return r.length}async deleteDeduplicationKey(e){let{rows:t}=await this.run("delete_deduplication_key",[this.queueName,e]);return t.length}async updateJobSchedulerNextMillis(e,t,r,n,i){var a,s;let{rows:o}=await this.run("update_job_scheduler",[this.queueName,e,null!=t?t:null,r||"{}",JSON.stringify(null!=n?n:{}),Date.now(),null!=i?i:null]);return null!=(s=null==(a=o[0])?void 0:a.job_id)?s:null}async removeJobScheduler(e){var t,r;let{rows:n}=await this.run("remove_job_scheduler",[this.queueName,e]);return null!=(r=null==(t=n[0])?void 0:t.removed)?r:0}async getJobScheduler(e){let{rows:t}=await this.run("get_job_scheduler",[this.queueName,e]);if(0===t.length)return[null,null];let{hash:r,next:n}=ih(t[0]),i=[];for(let[e,t]of Object.entries(r))i.push(e,t);return[i,n]}async isJobScheduler(e){var t,r;let{rows:n}=await this.run("is_job_scheduler",[this.queueName,e]);return null!=(r=null==(t=n[0])?void 0:t.exists)&&r}async getJobSchedulerData(e){let{rows:t}=await this.run("get_job_scheduler",[this.queueName,e]);return 0===t.length?{}:ih(t[0]).hash}async getJobSchedulersRange(e,t,r){let{rows:n}=await this.run("get_job_schedulers_range",[this.queueName,r,e,t<0?null:t-e+1]),i=[];for(let e of n)i.push(e.scheduler_id,String(e.next_run_ms));return i}async getJobSchedulersCount(){var e,t;let{rows:r}=await this.run("get_job_schedulers_count",[this.queueName]);return null!=(t=null==(e=r[0])?void 0:e.count)?t:0}async getState(e){let{rows:t}=await this.run("get_state",[this.queueName,e]);return t[0]?"waiting"===t[0].state&&t[0].priority>0?"prioritized":t[0].state:"unknown"}async isFinished(e,t){var r,n;let{rows:i}=await this.run("is_finished",[this.queueName,e]),a=i[0],s=0,o="";return a?"completed"===a.state?(s=1,o=JSON.stringify(null!=(r=a.return_value)?r:null)):"failed"===a.state&&(s=2,o=null!=(n=a.failed_reason)?n:""):(s=-1,o=`Missing key for job ${this.toKey(e)}. isFinished`),t?[s,o]:s}async isMaxed(){let{rows:e}=await this.run("is_maxed",[this.queueName]);return e[0].maxed}async isJobInState(e,t){if("active"===e){let{rows:e}=await this.run("is_job_in_state",[this.queueName,t,"active"]);return e[0].present}if("wait"===e||"paused"===e){let{rows:r}=await this.run("is_job_in_wait",[this.queueName,t,"paused"===e]);return r[0].present}if("waiting"===e)return await this.isJobInState("wait",t)||await this.isJobInState("paused",t);if("prioritized"===e){let{rows:e}=await this.run("is_job_prioritized",[this.queueName,t]);return e[0].present}if("completed"===e||"failed"===e||"delayed"===e||"waiting-children"===e){let{rows:r}=await this.run("is_job_in_state",[this.queueName,t,e]);return r[0].present}throw Error(`Unknown job state: ${e}`)}async getJobData(e){let{rows:t}=await this.run("get_job_data",[this.queueName,e]);return t[0]?ic(t[0]):void 0}async getDeduplicationJobId(e){var t,r;let{rows:n}=await this.run("get_deduplication_job_id",[this.queueName,e,Date.now()]);return null!=(r=null==(t=n[0])?void 0:t.job_id)?r:null}async getJobLogs(e,t,r,n){let{rows:i}=await this.run("get_job_logs_count",[this.queueName,e]),a=Number(i[0].count),s=t<0?Math.max(a+t,0):t,o=(r<0?a+r:r)-s+1;if(o<=0)return{logs:[],count:a};let{rows:l}=await this.run(n?"get_job_logs_asc":"get_job_logs_desc",[this.queueName,e,s,o]);return{logs:l.map(e=>e.row),count:a}}async getRateLimitTtl(e){let{rows:t}=await this.run("get_rate_limit_ttl",[this.queueName,null!=e?e:0,Date.now()]);return Number(t[0].ttl)}async getCounts(e){let{rows:t}=await this.run("get_counts",[this.queueName]),r=t[0],n=Number(r.waiting),i=Number(r.prioritized),a="1"===r.paused,s={active:Number(r.active),completed:Number(r.completed),failed:Number(r.failed),delayed:Number(r.delayed),wait:a?0:n,waiting:a?0:n,prioritized:i,"waiting-children":Number(r["waiting-children"]),paused:a?n:0};return e.map(e=>{var t;return null!=(t=s[e])?t:0})}async getCountsPerPriority(e){let{rows:t}=await this.run("get_counts_per_priority",[this.queueName,e]);return t.map(e=>Number(e.cnt))}async getRanges(e,t=0,r=-1,n=!1){let i=[];for(let a of e){let{rows:e}=await this.run("get_range",[this.queueName,a,t,r,n]);i.push(e.map(e=>e.id))}return i}async getDependencyCounts(e,t){let{rows:r}=await this.run("get_dependency_counts",[this.queueName,e]),n=r[0],i={processed:Number(n.processed),unprocessed:Number(n.unprocessed),ignored:Number(n.ignored),failed:Number(n.failed)};return t.map(e=>{var t;return null!=(t=i[e])?t:0})}async getDependencies(e,t){if(!t.processed&&!t.unprocessed&&!t.ignored&&!t.failed){let{rows:t}=await this.run("get_dependencies",[this.queueName,e]),r={},n=[],i={},a=[];for(let e of t)switch(e.status){case"processed":r[e.child_key]=e.value;break;case"pending":n.push(e.child_key);break;case"ignored":i[e.child_key]=e.value;break;case"failed":a.push(e.child_key)}return{processed:r,unprocessed:n,ignored:i,failed:a}}let r={},n=async(t,r=0,n=20)=>{let{rows:i}=await this.run("get_dependencies_page",[this.queueName,e,t,r,n]);return{rows:i,next:i.length<n?0:r+n}};if(t.processed){let{rows:e,next:i}=await n("processed",t.processed.cursor,t.processed.count),a={};for(let t of e)a[t.child_key]=t.value;r.processed=a,r.nextProcessedCursor=i}if(t.unprocessed){let{rows:e,next:i}=await n("pending",t.unprocessed.cursor,t.unprocessed.count);r.unprocessed=e.map(e=>e.child_key),r.nextUnprocessedCursor=i}if(t.ignored){let{rows:e,next:i}=await n("ignored",t.ignored.cursor,t.ignored.count),a={};for(let t of e)a[t.child_key]=t.value;r.ignored=a,r.nextIgnoredCursor=i}if(t.failed){let{rows:e,next:i}=await n("failed",t.failed.cursor,t.failed.count);r.failed=e.map(e=>e.child_key),r.nextFailedCursor=i}return r}async getProcessedChildrenValues(e){let{rows:t}=await this.run("get_processed_children_values",[this.queueName,e]),r={};for(let e of t)r[e.child_key]=e.value;return r}async getIgnoredChildrenFailures(e){let{rows:t}=await this.run("get_ignored_children_failures",[this.queueName,e]),r={};for(let e of t)r[e.child_key]=e.reason;return r}async collectMetrics(e,t){var r;let n=null==(r=this.opts.metrics)?void 0:r.maxDataPoints;n&&await this.run("collect_metrics",[this.queueName,e,n,t])}async getMetrics(e,t=0,r=-1){var n,i,a,s;let{rows:o}=await this.run("get_metrics",[this.queueName,e,t,r]),l=null!=(i=null==(n=o[0])?void 0:n.total)?i:"0",d=(null!=(s=null==(a=o[0])?void 0:a.data)?s:[]).map(String);return[[l,"0","0"],d,d.length]}async getClientList(){let{rows:e}=await this.run("get_client_list");return[e.map(e=>`name=${e.application_name}`).join("\n")]}async paginate(e,t){var r;let n,i,a=`${this.queueName}:`,s=e.startsWith(a)?e.slice(a.length):e,o=!1;if(s.endsWith(":processed"))n="processed",o=!0,i=s.slice(0,-10);else{if(!s.endsWith(":dependencies"))return iu("paginate");n="pending",i=s.slice(0,-13)}let l=Math.max(null!=(r=t.start)?r:0,0),d=null!=t.end&&t.end>=0?t.end-l+1:null,{rows:c}=await this.run("paginate_dependencies",[this.queueName,i,n,l,d]),u=c.length?Number(c[0].total):0;return{cursor:"0",items:c.map(e=>o?{id:e.child_key,v:e.dep_value}:{id:e.child_key}),total:u,jobs:t.fetchJobs?c.filter(e=>null!=e.id).map(e=>ic(e)):void 0}}async setQueueMeta(e){let t=Object.keys(e);if(0===t.length)return 0;let r=t.map(t=>String(e[t])),{rowCount:n}=await this.run("set_queue_meta",[this.queueName,t,r]);return null!=n?n:t.length}async getQueueMetaField(e){var t,r;let{rows:n}=await this.run("get_queue_meta_field",[this.queueName,e]);return null!=(r=null==(t=n[0])?void 0:t.value)?r:null}async getQueueMetaFields(e){if(0===e.length)return[];let{rows:t}=await this.run("get_queue_meta_fields",[this.queueName,e]),r=new Map(t.map(e=>[e.field,e.value]));return e.map(e=>{var t;return null!=(t=r.get(e))?t:null})}async getQueueMeta(){let{rows:e}=await this.run("get_queue_meta",[this.queueName]),t={};for(let r of e)t[r.field]=r.value;return t}async removeQueueMetaFields(e){if(0===e.length)return 0;let{rowCount:t}=await this.run("remove_queue_meta_fields",[this.queueName,e]);return null!=t?t:0}async hasQueueMetaField(e){let{rows:t}=await this.run("has_queue_meta_field",[this.queueName,e]);return t[0].exists}async setRateLimit(e){await this.run("set_rate_limit",[this.queueName,e,Date.now()])}async removeRateLimitKey(){let{rows:e}=await this.run("remove_rate_limit",[this.queueName]);return e[0].n}removeDeprecatedPriorityKey(){return iu("removeDeprecatedPriorityKey")}trimEvents(e){return iu("trimEvents")}async publishEvent(e,t){let{event:r}=e,n=(0,tU.__rest)(e,["event"]),{rows:i}=await this.run("publish_event",[this.queueName,String(r),JSON.stringify(n)]);return String(i[0].id)}async readEvents(e,t){let r;if(this.closing||this.connection.isClosing)return null;if("$"===e){let{rows:e}=await this.run("read_events_max",[this.queueName]);r=e[0].max}else r=e;let n=await this.fetchEvents(r);if(0===n.length){if(await this.waitForEvent(t),this.closing||this.connection.isClosing)return null;n=await this.fetchEvents(r)}return 0===n.length?null:[["events",n.map(e=>[e.id,e.fields])]]}async fetchEvents(e){let{rows:t}=await this.run("read_events",[this.queueName,e,100]);return t.map(e=>{var t;let r=["event",e.event];for(let[n,i]of Object.entries(null!=(t=e.data)?t:{}))r.push(n,"string"==typeof i?i:String(i));return{id:String(e.id),fields:r}})}async ensureListening(){let e=await this.connection.getListenClient();return this.listening||(await e.query(nX("listen_jobs")),this.listening=!0),e}async ensureListeningEvents(){let e=await this.connection.getListenClient();return this.listeningEvents||(await e.query(nX("listen_events")),this.listeningEvents=!0),e}async waitForEvent(e){if(this.closing||this.connection.isClosing)return;let t=await this.ensureListeningEvents();return new Promise(r=>{let n=!1,i=()=>{n||(n=!0,clearTimeout(s),t.removeListener("notification",a),this.cancelEventWait=void 0,r())},a=e=>{e.channel===ip.EVENTS_CHANNEL&&e.payload===this.queueName&&i()},s=setTimeout(i,Math.max(e||5e3,1));this.cancelEventWait=i,t.on("notification",a)})}async waitForJob(e){if(this.closing||this.blockingDisconnected)return null;let t=await this.ensureListening();return this.closing||this.blockingDisconnected?null:new Promise(r=>{let n=!1,i=e=>{n||(n=!0,clearTimeout(s),t.removeListener("notification",a),this.cancelWait=void 0,r(e))},a=e=>{var t;e.channel===ip.NOTIFY_CHANNEL&&e.payload===this.queueName&&i({member:null!=(t=e.payload)?t:"",score:0})},s=setTimeout(()=>i(null),1e3*Math.max(e,0));(this.cancelWait=()=>i(null),t.on("notification",a),this.blockingDisconnected)?i(null):(this.run("has_waiting_job",[this.queueName]).then(({rows:e})=>{var t;(null==(t=e[0])?void 0:t.present)&&i({member:this.queueName,score:0})}).catch(()=>{}),this.run("next_delay",[this.queueName]).then(({rows:t})=>{var r,a;let o=il(null!=(a=null==(r=t[0])?void 0:r.next_delay)?a:null);if(void 0===o||n)return;let l=o-Date.now();l<=0?i(null):l<1e3*Math.max(e,0)&&(clearTimeout(s),s=setTimeout(()=>i(null),l))}).catch(()=>{}))})}async disconnectBlocking(e=!0){var t;this.blockingDisconnected=!0,null==(t=this.cancelWait)||t.call(this)}async reconnectBlocking(){this.blockingDisconnected=!1,this.listening=!1}}ip.NOTIFY_CHANNEL="bullmq_jobs",ip.EVENTS_CHANNEL="bullmq_events",e.s([],89042),e.s([],33591),e.i(33591),e.i(61119),e.i(32116),e.i(72844),e.i(43279),e.i(21069),e.i(63126),e.s([],93042),e.i(93042),e.i(28587),e.i(51020),e.i(42532),e.i(38626),e.i(36076),e.i(31636),e.s(["CONNECTION_CLOSED_ERROR_MSG",0,H,"ConnectionClosedError",0,B,"DELAYED_ERROR",0,nN,"DelayedError",0,nP,"RATE_LIMIT_ERROR",0,nJ,"RateLimitError",0,nL,"UNRECOVERABLE_ERROR",0,tP,"UnrecoverableError",0,tJ,"WAITING_CHILDREN_ERROR",0,nq,"WAITING_ERROR",0,nV,"WaitingChildrenError",0,nF,"WaitingError",0,n_],50225),e.i(50225),e.i(46124),e.i(28290),e.i(96094),e.i(2359),e.i(29844),e.i(81652),e.i(30791),e.i(98291),e.i(11684),e.i(54674),e.i(21851),e.i(19811),e.i(71189),e.i(28998),e.i(49273),e.i(8889),e.i(19148),e.i(30481),e.s(["AsyncFifoQueue",0,nM,"Backoffs",0,d,"CONNECTION_CLOSED_ERROR_MSG",0,H,"Child",0,V,"ChildPool",0,$,"ChildProcessor",0,ej,"ConnectionClosedError",0,B,"DELAYED_ERROR",0,nN,"DelayedError",0,nP,"FlowProducer",0,ne,"Job",0,r9,"JobScheduler",0,nv,"LEGACY_REPEATABLE_JOBS_MIGRATION_URL",0,nf,"LockManager",0,nw,"PRIORITY_LIMIT",0,2097151,"Queue",0,nD,"QueueBase",0,ny,"QueueEvents",0,nS,"QueueEventsProducer",0,nk,"QueueGetters",0,nx,"QueueKeys",0,tq,"RATE_LIMIT_ERROR",0,nJ,"RateLimitError",0,nL,"RedisConnection",0,r3,"RedisQueueBackend",0,tG,"UNRECOVERABLE_ERROR",0,tP,"UnrecoverableError",0,tJ,"WAITING_CHILDREN_ERROR",0,nq,"WAITING_ERROR",0,nV,"WaitingChildrenError",0,nF,"WaitingError",0,n_,"Worker",0,nG,"createBunRedisClient",0,rz,"createIORedisClient",0,rP,"createNodeRedisClient",0,r_,"createValkeyGlideClient",0,nc,"defaultRepeatStrategy",0,nE,"getLegacyRepeatableJobError",0,nK,"getNextMillis",0,nI,"hasLegacyRepeatableKeyShape",0,ng,"isIRedisClient",0,rL,"isLegacyRepeatableJobKey",0,ng,"raw2NextJobData",0,tY],17337),e.i(17337),e.i(59902),e.i(84541),e.i(52885),e.i(39845),e.i(43044),e.i(40723),e.s(["ChildCommand",0,K,"ErrorCode",0,v,"MetricNames",0,S,"MetricsTime",0,I,"ParentCommand",0,E,"SpanKind",0,k,"TelemetryAttributes",0,w],8854),e.i(8854),e.i(33977),e.s([],48934),e.i(48934),e.s([],74943),e.i(74943),e.s([],21039),e.i(21039),e.s([],50138),e.i(50138),e.s([],47831),e.i(47831),e.s([],71096),e.i(71096),e.s([],62974),e.i(62974),e.s([],16181),e.i(16181),e.s([],75230),e.i(75230),e.s([],59654),e.i(59654),e.s([],20625),e.i(20625),e.s([],67712),e.i(67712),e.s([],23667),e.i(23667),e.s([],35658),e.i(35658),e.s([],43156),e.i(43156),e.s([],15370),e.i(15370),e.s([],36455),e.i(36455),e.s([],17504),e.i(17504),e.s([],99659),e.i(99659),e.i(88639),e.s([],88727),e.i(88727),e.s([],29885),e.i(29885),e.s([],28004),e.i(28004),e.s([],84985),e.i(84985),e.s([],29856),e.i(29856),e.s([],84412),e.i(84412),e.s([],57050),e.i(57050),e.s([],79246),e.i(79246),e.s([],98607),e.i(98607),e.s([],70093),e.i(70093),e.s([],7097),e.i(7097),e.s([],3318),e.i(3318),e.s([],73029),e.i(73029),e.s([],16400),e.i(16400),e.s(["ClientType",0,N],30246),e.i(30246),e.s([],44293),e.i(44293),e.s([],90362),e.i(90362),e.s([],85980),e.i(85980),e.s([],96066),e.i(96066),e.s([],31217),e.i(31217),e.s([],88077),e.i(88077),e.s([],99444),e.i(99444),e.s([],33239),e.i(33239),e.s([],94519),e.i(94519),e.s([],17340),e.i(17340),e.s([],97338),e.i(97338),e.s([],27155),e.i(27155),e.s([],17444),e.i(17444),e.i(55170),e.s(["DELAY_TIME_1",0,100,"DELAY_TIME_5",0,5e3,"QUEUE_EVENT_SUFFIX",0,":qe","array2obj",0,er,"asyncSend",0,eb,"childSend",0,eg,"clientCommandMessageReg",0,ey,"decreaseMaxListeners",0,eh,"delay",0,ei,"errorObject",0,X,"errorToJSON",0,eE,"forwardConnectionError",0,ea,"getParentKey",0,em,"increaseMaxListeners",0,es,"invertObject",0,eo,"isEmpty",0,et,"isNotConnectionError",0,ef,"isRedisCluster",0,eu,"isRedisInstance",0,ec,"isRedisVersionLowerThan",0,eK,"lengthInUtf8Bytes",0,ee,"objectToFlatArray",0,en,"optsDecodeMap",0,el,"optsEncodeMap",0,ed,"parseObjectValues",0,ev,"randomUUID",()=>z.randomUUID,"removeAllQueueData",0,ep,"removeUndefinedFields",0,eS,"toString",0,ew,"trace",0,ek,"tryCatch",0,Q],17324),e.i(17324),e.s([],54389),e.i(54389),e.i(26460),e.i(89042),e.s(["BULLMQ_MAJOR_VERSION",0,n2,"DEFAULT_SCHEMA",0,n1,"LATEST_SCHEMA_VERSION",0,n0,"MIGRATION_ADVISORY_LOCK_KEY",0,0x42554c4c,"MINIMUM_POSTGRES_VERSION",0,13,"PostgresConnection",0,is,"PostgresQueueBackend",0,ip,"RECOMMENDED_POSTGRES_VERSION",0,14,"SchemaMigrationRequiredError",0,n8,"SchemaVersionMismatchError",0,n5,"UnsupportedPostgresVersionError",0,n3,"assertPostgresVersion",0,n4,"assertSchemaCompatibility",0,n9,"createPostgresBackend",0,(e,t,r={})=>{let n,i=new is(t.connection),a=t.name;return r.withBlockingConnection?n=`${e}${a?`:w:${a}`:""}`:r.blocking&&(n=`${e}:qe`),new ip(i,e,t,!0,n)},"isPgPool",0,n$,"quoteSchemaName",0,n6,"runMigrations",0,n7],88260),e.i(88260),e.s(["Queue",0,nD],6516)},49772,(e,t,r)=>{"use strict";let n=()=>"linux"===process.platform,i=null;t.exports={isLinux:n,getReport:()=>{if(!i)if(n()&&process.report){let e=process.report.excludeNetwork;process.report.excludeNetwork=!0,i=process.report.getReport(),process.report.excludeNetwork=e}else i={};return i}}},48150,(e,t,r)=>{"use strict";let n=e.r(22734);t.exports={LDD_PATH:"/usr/bin/ldd",SELF_PATH:"/proc/self/exe",readFileSync:e=>{let t=n.openSync(e,"r"),r=Buffer.alloc(2048),i=n.readSync(t,r,0,2048,0);return n.close(t,()=>{}),r.subarray(0,i)},readFile:e=>new Promise((t,r)=>{n.open(e,"r",(e,i)=>{if(e)r(e);else{let e=Buffer.alloc(2048);n.read(i,e,0,2048,0,(r,a)=>{t(e.subarray(0,a)),n.close(i,()=>{})})}})})}},14496,(e,t,r)=>{"use strict";t.exports={interpreterPath:e=>{if(e.length<64||0x7f454c46!==e.readUInt32BE(0)||2!==e.readUInt8(4)||1!==e.readUInt8(5))return null;let t=e.readUInt32LE(32),r=e.readUInt16LE(54),n=e.readUInt16LE(56);for(let i=0;i<n;i++){let n=t+i*r;if(3===e.readUInt32LE(n)){let t=e.readUInt32LE(n+8),r=e.readUInt32LE(n+32);return e.subarray(t,t+r).toString().replace(/\0.*$/g,"")}}return null}}},55146,(e,t,r)=>{"use strict";let n,i,a,s=e.r(33405),{isLinux:o,getReport:l}=e.r(49772),{LDD_PATH:d,SELF_PATH:c,readFile:u,readFileSync:h}=e.r(48150),{interpreterPath:p}=e.r(14496),m="getconf GNU_LIBC_VERSION 2>&1 || true; ldd --version 2>&1 || true",y="",f=()=>y||new Promise(e=>{s.exec(m,(t,r)=>{e(y=t?" ":r)})}),b=()=>{if(!y)try{y=s.execSync(m,{encoding:"utf8"})}catch(e){y=" "}return y},g="glibc",K=/LIBC[a-z0-9 \-).]*?(\d+\.\d+)/i,v="musl",E=e=>e.includes("libc.musl-")||e.includes("ld-musl-"),I=()=>{let e=l();return e.header&&e.header.glibcVersionRuntime?g:Array.isArray(e.sharedObjects)&&e.sharedObjects.some(E)?v:null},w=e=>{let[t,r]=e.split(/[\r\n]+/);return t&&t.includes(g)?g:r&&r.includes(v)?v:null},S=e=>{if(e){if(e.includes("/ld-musl-"))return v;else if(e.includes("/ld-linux-"))return g}return null},k=e=>(e=e.toString()).includes("musl")?v:e.includes("GNU C Library")?g:null,j=async()=>{if(void 0!==i)return i;i=null;try{let e=await u(d);i=k(e)}catch(e){}return i},x=async()=>{if(void 0!==n)return n;n=null;try{let e=await u(c),t=p(e);n=S(t)}catch(e){}return n},D=async()=>{let e=null;return o()&&((e=await x())||((e=await j())||(e=I()),e||(e=w(await f())))),e},C=()=>{let e=null;return o()&&((e=(()=>{if(void 0!==n)return n;n=null;try{let e=h(c),t=p(e);n=S(t)}catch(e){}return n})())||((e=(()=>{if(void 0!==i)return i;i=null;try{let e=h(d);i=k(e)}catch(e){}return i})())||(e=I()),e||(e=w(b())))),e},T=async()=>o()&&await D()!==g,O=async()=>{if(void 0!==a)return a;a=null;try{let e=(await u(d)).match(K);e&&(a=e[1])}catch(e){}return a},R=()=>{let e=l();return e.header&&e.header.glibcVersionRuntime?e.header.glibcVersionRuntime:null},A=e=>e.trim().split(/\s+/)[1],M=e=>{let[t,r,n]=e.split(/[\r\n]+/);return t&&t.includes(g)?A(t):r&&n&&r.includes(v)?A(n):null};t.exports={GLIBC:g,MUSL:v,family:D,familySync:C,isNonGlibcLinux:T,isNonGlibcLinuxSync:()=>o()&&C()!==g,version:async()=>{let e=null;return o()&&((e=await O())||(e=R()),e||(e=M(await f()))),e},versionSync:()=>{let e=null;return o()&&((e=(()=>{if(void 0!==a)return a;a=null;try{let e=h(d).match(K);e&&(a=e[1])}catch(e){}return a})())||(e=R()),e||(e=M(b()))),e}}},56943,(e,t,r)=>{var n=e.r(22734),i=e.r(14747),a=e.r(92509),s=e.r(46786),o="function"==typeof __webpack_require__?__non_webpack_require__:e.t,l=process.config&&process.config.variables||{},d=!!process.env.PREBUILDS_ONLY,c=process.versions,u=c.modules;(c.deno||process.isBun)&&(u="unsupported");var h=process.versions&&process.versions.electron||process.env.ELECTRON_RUN_AS_NODE?"electron":process.versions&&process.versions.nw?"node-webkit":"node",p=process.env.npm_config_arch||s.arch(),m=process.env.npm_config_platform||s.platform(),y=process.env.LIBC||(!function(t){if("linux"!==t)return!1;let{familySync:r,MUSL:n}=e.r(55146);return r()===n}(m)?"glibc":"musl"),f=process.env.ARM_VERSION||("arm64"===p?"8":l.arm_version)||"",b=(c.uv||"").split(".")[0];function g(e){return o(g.resolve(e))}function K(e){try{return n.readdirSync(e)}catch(e){return[]}}function v(e,t){var r=K(e).filter(t);return r[0]&&i.join(e,r[0])}function E(e){return/\.node$/.test(e)}function I(e){var t=e.split("-");if(2===t.length){var r=t[0],n=t[1].split("+");if(r&&n.length&&n.every(Boolean))return{name:e,platform:r,architectures:n}}}function w(e,t){return function(r){return null!=r&&r.platform===e&&r.architectures.includes(t)}}function S(e,t){return e.architectures.length-t.architectures.length}function k(e){var t=e.split("."),r=t.pop(),n={file:e,specificity:0};if("node"===r){for(var i=0;i<t.length;i++){var a=t[i];if("node"===a||"electron"===a||"node-webkit"===a)n.runtime=a;else if("napi"===a)n.napi=!0;else if("abi"===a.slice(0,3))n.abi=a.slice(3);else if("uv"===a.slice(0,2))n.uv=a.slice(2);else if("armv"===a.slice(0,4))n.armv=a.slice(4);else{if("glibc"!==a&&"musl"!==a)continue;n.libc=a}n.specificity++}return n}}function j(e,t){return function(r){var n;return null!=r&&(r.runtime===e||!!("node"===(n=r).runtime&&n.napi))&&(r.abi===t||!!r.napi)&&(!r.uv||r.uv===b)&&(!r.armv||r.armv===f)&&(!r.libc||r.libc===y)&&!0}}function x(e){return function(t,r){return t.runtime!==r.runtime?t.runtime===e?-1:1:t.abi!==r.abi?t.abi?-1:1:t.specificity!==r.specificity?t.specificity>r.specificity?-1:1:0}}t.exports=g,g.resolve=g.path=function(t){t=i.resolve(t||".");var r,n,s="";try{var l=(s=o(i.join(t,"package.json")).name).toUpperCase().replace(/-/g,"_");process.env[l+"_PREBUILD"]&&(t=process.env[l+"_PREBUILD"])}catch(e){r=e}if(!d){var c=v(i.join(t,"build/Release"),E);if(c)return c;var g=v(i.join(t,"build/Debug"),E);if(g)return g}var D=A(t);if(D)return D;var C=A(i.dirname(process.execPath));if(C)return C;var T=("@"==s[0]?"":"@"+s+"/")+s+"-"+m+"-"+p;try{var O=i.dirname(e.r(62562).createRequire(a.pathToFileURL(i.join(t,"package.json"))).resolve(T));return M(O)}catch(e){n=e}let R="No native build was found for "+["platform="+m,"arch="+p,"runtime="+h,"abi="+u,"uv="+b,f?"armv="+f:"","libc="+y,"node="+process.versions.node,process.versions.electron?"electron="+process.versions.electron:"","function"==typeof __webpack_require__?"webpack=true":""].filter(Boolean).join(" ")+"\n    attempted loading from: "+t+" and package: "+T+"\n";throw r&&(R+="Error finding package.json: "+r.message+"\n"),n&&(R+="Error resolving package: "+n.message+"\n"),Error(R);function A(e){var t=K(i.join(e,"prebuilds")).map(I).filter(w(m,p)).sort(S)[0];if(t)return M(i.join(e,"prebuilds",t.name))}function M(e){var t=K(e).map(k).filter(j(h,u)).sort(x(h))[0];if(t)return i.join(e,t.file)}},g.parseTags=k,g.matchTags=j,g.compareTags=x,g.parseTuple=I,g.matchTuple=w,g.compareTuples=S},80583,(e,t,r)=>{let n="function"==typeof __webpack_require__?__non_webpack_require__:e.t;"function"==typeof n.addon?t.exports=n.addon.bind(n):t.exports=e.r(56943)},70156,(e,t,r)=>{t.exports=e.r(80583)("/ROOT/node_modules/msgpackr-extract")},50245,(e,t,r)=>{let{EventEmitter:n}=e.r(27699);class AbortSignal{constructor(){this.eventEmitter=new n,this.onabort=null,this.aborted=!1,this.reason=void 0}toString(){return"[object AbortSignal]"}get[Symbol.toStringTag](){return"AbortSignal"}removeEventListener(e,t){this.eventEmitter.removeListener(e,t)}addEventListener(e,t){this.eventEmitter.on(e,t)}dispatchEvent(e){let t={type:e,target:this},r=`on${e}`;"function"==typeof this[r]&&this[r](t),this.eventEmitter.emit(e,t)}throwIfAborted(){if(this.aborted)throw this.reason}static abort(e){let t=new i;return t.abort(),t.signal}static timeout(e){let t=new i;return setTimeout(()=>t.abort(Error("TimeoutError")),e),t.signal}}class i{constructor(){this.signal=new AbortSignal}abort(e){this.signal.aborted||(this.signal.aborted=!0,e?this.signal.reason=e:this.signal.reason=Error("AbortError"),this.signal.dispatchEvent("abort"))}toString(){return"[object AbortController]"}get[Symbol.toStringTag](){return"AbortController"}}t.exports={AbortController:i,AbortSignal}},38703,(e,t,r)=>{"use strict";t.exports={MAX_LENGTH:256,MAX_SAFE_COMPONENT_LENGTH:16,MAX_SAFE_BUILD_LENGTH:250,MAX_SAFE_INTEGER:Number.MAX_SAFE_INTEGER||0x1fffffffffffff,RELEASE_TYPES:["major","premajor","minor","preminor","patch","prepatch","prerelease"],SEMVER_SPEC_VERSION:"2.0.0",FLAG_INCLUDE_PRERELEASE:1,FLAG_LOOSE:2}},91130,(e,t,r)=>{"use strict";t.exports="object"==typeof process&&process.env&&process.env.NODE_DEBUG&&/\bsemver\b/i.test(process.env.NODE_DEBUG)?(...e)=>console.error("SEMVER",...e):()=>{}},70547,(e,t,r)=>{"use strict";let{MAX_SAFE_COMPONENT_LENGTH:n,MAX_SAFE_BUILD_LENGTH:i,MAX_LENGTH:a}=e.r(38703),s=e.r(91130),o=(r=t.exports={}).re=[],l=r.safeRe=[],d=r.src=[],c=r.safeSrc=[],u=r.t={},h=0,p="[a-zA-Z0-9-]",m=[["\\s",1],["\\d",a],[p,i]],y=(e,t,r)=>{let n=(e=>{for(let[t,r]of m)e=e.split(`${t}*`).join(`${t}{0,${r}}`).split(`${t}+`).join(`${t}{1,${r}}`);return e})(t),i=h++;s(e,i,t),u[e]=i,d[i]=t,c[i]=n,o[i]=new RegExp(t,r?"g":void 0),l[i]=new RegExp(n,r?"g":void 0)};y("NUMERICIDENTIFIER","0|[1-9]\\d*"),y("NUMERICIDENTIFIERLOOSE","\\d+"),y("NONNUMERICIDENTIFIER",`\\d*[a-zA-Z-]${p}*`),y("MAINVERSION",`(${d[u.NUMERICIDENTIFIER]})\\.(${d[u.NUMERICIDENTIFIER]})\\.(${d[u.NUMERICIDENTIFIER]})`),y("MAINVERSIONLOOSE",`(${d[u.NUMERICIDENTIFIERLOOSE]})\\.(${d[u.NUMERICIDENTIFIERLOOSE]})\\.(${d[u.NUMERICIDENTIFIERLOOSE]})`),y("PRERELEASEIDENTIFIER",`(?:${d[u.NONNUMERICIDENTIFIER]}|${d[u.NUMERICIDENTIFIER]})`),y("PRERELEASEIDENTIFIERLOOSE",`(?:${d[u.NONNUMERICIDENTIFIER]}|${d[u.NUMERICIDENTIFIERLOOSE]})`),y("PRERELEASE",`(?:-(${d[u.PRERELEASEIDENTIFIER]}(?:\\.${d[u.PRERELEASEIDENTIFIER]})*))`),y("PRERELEASELOOSE",`(?:-?(${d[u.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${d[u.PRERELEASEIDENTIFIERLOOSE]})*))`),y("BUILDIDENTIFIER",`${p}+`),y("BUILD",`(?:\\+(${d[u.BUILDIDENTIFIER]}(?:\\.${d[u.BUILDIDENTIFIER]})*))`),y("FULLPLAIN",`v?${d[u.MAINVERSION]}${d[u.PRERELEASE]}?${d[u.BUILD]}?`),y("FULL",`^${d[u.FULLPLAIN]}$`),y("LOOSEPLAIN",`[v=\\s]*${d[u.MAINVERSIONLOOSE]}${d[u.PRERELEASELOOSE]}?${d[u.BUILD]}?`),y("LOOSE",`^${d[u.LOOSEPLAIN]}$`),y("GTLT","((?:<|>)?=?)"),y("XRANGEIDENTIFIERLOOSE",`${d[u.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`),y("XRANGEIDENTIFIER",`${d[u.NUMERICIDENTIFIER]}|x|X|\\*`),y("XRANGEPLAIN",`[v=\\s]*(${d[u.XRANGEIDENTIFIER]})(?:\\.(${d[u.XRANGEIDENTIFIER]})(?:\\.(${d[u.XRANGEIDENTIFIER]})(?:${d[u.PRERELEASE]})?${d[u.BUILD]}?)?)?`),y("XRANGEPLAINLOOSE",`[v=\\s]*(${d[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${d[u.XRANGEIDENTIFIERLOOSE]})(?:\\.(${d[u.XRANGEIDENTIFIERLOOSE]})(?:${d[u.PRERELEASELOOSE]})?${d[u.BUILD]}?)?)?`),y("XRANGE",`^${d[u.GTLT]}\\s*${d[u.XRANGEPLAIN]}$`),y("XRANGELOOSE",`^${d[u.GTLT]}\\s*${d[u.XRANGEPLAINLOOSE]}$`),y("COERCEPLAIN",`(^|[^\\d])(\\d{1,${n}})(?:\\.(\\d{1,${n}}))?(?:\\.(\\d{1,${n}}))?`),y("COERCE",`${d[u.COERCEPLAIN]}(?:$|[^\\d])`),y("COERCEFULL",d[u.COERCEPLAIN]+`(?:${d[u.PRERELEASE]})?`+`(?:${d[u.BUILD]})?`+"(?:$|[^\\d])"),y("COERCERTL",d[u.COERCE],!0),y("COERCERTLFULL",d[u.COERCEFULL],!0),y("LONETILDE","(?:~>?)"),y("TILDETRIM",`(\\s*)${d[u.LONETILDE]}\\s+`,!0),r.tildeTrimReplace="$1~",y("TILDE",`^${d[u.LONETILDE]}${d[u.XRANGEPLAIN]}$`),y("TILDELOOSE",`^${d[u.LONETILDE]}${d[u.XRANGEPLAINLOOSE]}$`),y("LONECARET","(?:\\^)"),y("CARETTRIM",`(\\s*)${d[u.LONECARET]}\\s+`,!0),r.caretTrimReplace="$1^",y("CARET",`^${d[u.LONECARET]}${d[u.XRANGEPLAIN]}$`),y("CARETLOOSE",`^${d[u.LONECARET]}${d[u.XRANGEPLAINLOOSE]}$`),y("COMPARATORLOOSE",`^${d[u.GTLT]}\\s*(${d[u.LOOSEPLAIN]})$|^$`),y("COMPARATOR",`^${d[u.GTLT]}\\s*(${d[u.FULLPLAIN]})$|^$`),y("COMPARATORTRIM",`(\\s*)${d[u.GTLT]}\\s*(${d[u.LOOSEPLAIN]}|${d[u.XRANGEPLAIN]})`,!0),r.comparatorTrimReplace="$1$2$3",y("HYPHENRANGE",`^\\s*(${d[u.XRANGEPLAIN]})\\s+-\\s+(${d[u.XRANGEPLAIN]})\\s*$`),y("HYPHENRANGELOOSE",`^\\s*(${d[u.XRANGEPLAINLOOSE]})\\s+-\\s+(${d[u.XRANGEPLAINLOOSE]})\\s*$`),y("STAR","(<|>)?=?\\s*\\*"),y("GTE0","^\\s*>=\\s*0\\.0\\.0\\s*$"),y("GTE0PRE","^\\s*>=\\s*0\\.0\\.0-0\\s*$")},82789,(e,t,r)=>{"use strict";let n=Object.freeze({loose:!0}),i=Object.freeze({});t.exports=e=>e?"object"!=typeof e?n:e:i},18429,(e,t,r)=>{"use strict";let n=/^[0-9]+$/,i=(e,t)=>{if("number"==typeof e&&"number"==typeof t)return e===t?0:e<t?-1:1;let r=n.test(e),i=n.test(t);return r&&i&&(e*=1,t*=1),e===t?0:r&&!i?-1:i&&!r?1:e<t?-1:1};t.exports={compareIdentifiers:i,rcompareIdentifiers:(e,t)=>i(t,e)}},20326,(e,t,r)=>{"use strict";let n=e.r(91130),{MAX_LENGTH:i,MAX_SAFE_INTEGER:a}=e.r(38703),{safeRe:s,t:o}=e.r(70547),l=e.r(82789),{compareIdentifiers:d}=e.r(18429);t.exports=class e{constructor(t,r){if(r=l(r),t instanceof e)if(!!r.loose===t.loose&&!!r.includePrerelease===t.includePrerelease)return t;else t=t.version;else if("string"!=typeof t)throw TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);if(t.length>i)throw TypeError(`version is longer than ${i} characters`);n("SemVer",t,r),this.options=r,this.loose=!!r.loose,this.includePrerelease=!!r.includePrerelease;const d=t.trim().match(r.loose?s[o.LOOSE]:s[o.FULL]);if(!d)throw TypeError(`Invalid Version: ${t}`);if(this.raw=t,this.major=+d[1],this.minor=+d[2],this.patch=+d[3],this.major>a||this.major<0)throw TypeError("Invalid major version");if(this.minor>a||this.minor<0)throw TypeError("Invalid minor version");if(this.patch>a||this.patch<0)throw TypeError("Invalid patch version");d[4]?this.prerelease=d[4].split(".").map(e=>{if(/^[0-9]+$/.test(e)){let t=+e;if(t>=0&&t<a)return t}return e}):this.prerelease=[],this.build=d[5]?d[5].split("."):[],this.format()}format(){return this.version=`${this.major}.${this.minor}.${this.patch}`,this.prerelease.length&&(this.version+=`-${this.prerelease.join(".")}`),this.version}toString(){return this.version}compare(t){if(n("SemVer.compare",this.version,this.options,t),!(t instanceof e)){if("string"==typeof t&&t===this.version)return 0;t=new e(t,this.options)}return t.version===this.version?0:this.compareMain(t)||this.comparePre(t)}compareMain(t){return(t instanceof e||(t=new e(t,this.options)),this.major<t.major)?-1:this.major>t.major?1:this.minor<t.minor?-1:this.minor>t.minor?1:this.patch<t.patch?-1:+(this.patch>t.patch)}comparePre(t){if(t instanceof e||(t=new e(t,this.options)),this.prerelease.length&&!t.prerelease.length)return -1;if(!this.prerelease.length&&t.prerelease.length)return 1;if(!this.prerelease.length&&!t.prerelease.length)return 0;let r=0;do{let e=this.prerelease[r],i=t.prerelease[r];if(n("prerelease compare",r,e,i),void 0===e&&void 0===i)return 0;if(void 0===i)return 1;if(void 0===e)return -1;else if(e===i)continue;else return d(e,i)}while(++r)}compareBuild(t){t instanceof e||(t=new e(t,this.options));let r=0;do{let e=this.build[r],i=t.build[r];if(n("build compare",r,e,i),void 0===e&&void 0===i)return 0;if(void 0===i)return 1;if(void 0===e)return -1;else if(e===i)continue;else return d(e,i)}while(++r)}inc(e,t,r){if(e.startsWith("pre")){if(!t&&!1===r)throw Error("invalid increment argument: identifier is empty");if(t){let e=`-${t}`.match(this.options.loose?s[o.PRERELEASELOOSE]:s[o.PRERELEASE]);if(!e||e[1]!==t)throw Error(`invalid identifier: ${t}`)}}switch(e){case"premajor":this.prerelease.length=0,this.patch=0,this.minor=0,this.major++,this.inc("pre",t,r);break;case"preminor":this.prerelease.length=0,this.patch=0,this.minor++,this.inc("pre",t,r);break;case"prepatch":this.prerelease.length=0,this.inc("patch",t,r),this.inc("pre",t,r);break;case"prerelease":0===this.prerelease.length&&this.inc("patch",t,r),this.inc("pre",t,r);break;case"release":if(0===this.prerelease.length)throw Error(`version ${this.raw} is not a prerelease`);this.prerelease.length=0;break;case"major":(0!==this.minor||0!==this.patch||0===this.prerelease.length)&&this.major++,this.minor=0,this.patch=0,this.prerelease=[];break;case"minor":(0!==this.patch||0===this.prerelease.length)&&this.minor++,this.patch=0,this.prerelease=[];break;case"patch":0===this.prerelease.length&&this.patch++,this.prerelease=[];break;case"pre":{let e=+!!Number(r);if(0===this.prerelease.length)this.prerelease=[e];else{let n=this.prerelease.length;for(;--n>=0;)"number"==typeof this.prerelease[n]&&(this.prerelease[n]++,n=-2);if(-1===n){if(t===this.prerelease.join(".")&&!1===r)throw Error("invalid increment argument: identifier already exists");this.prerelease.push(e)}}if(t){let n=[t,e];!1===r&&(n=[t]),((e,t)=>{let r=t.split(".");if(r.length>e.length)return!1;for(let t=0;t<r.length;t++)if(0!==d(e[t],r[t]))return!1;return!0})(this.prerelease,t)?isNaN(this.prerelease[t.split(".").length])&&(this.prerelease=n):this.prerelease=n}break}default:throw Error(`invalid increment argument: ${e}`)}return this.raw=this.format(),this.build.length&&(this.raw+=`+${this.build.join(".")}`),this}}},35759,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t,r=!1)=>{if(e instanceof n)return e;try{return new n(e,t)}catch(e){if(!r)return null;throw e}}},32,(e,t,r)=>{"use strict";let n=e.r(35759);t.exports=(e,t)=>{let r=n(e,t);return r?r.version:null}},76730,(e,t,r)=>{"use strict";let n=e.r(35759);t.exports=(e,t)=>{let r=n(e.trim().replace(/^[=v]+/,""),t);return r?r.version:null}},96161,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t,r,i,a)=>{"string"==typeof r&&(a=i,i=r,r=void 0);try{return new n(e instanceof n?e.version:e,r).inc(t,i,a).version}catch(e){return null}}},16022,(e,t,r)=>{"use strict";let n=e.r(35759);t.exports=(e,t)=>{let r=n(e,null,!0),i=n(t,null,!0),a=r.compare(i);if(0===a)return null;let s=a>0,o=s?r:i,l=s?i:r,d=!!o.prerelease.length;if(l.prerelease.length&&!d){if(!l.patch&&!l.minor)return"major";if(0===l.compareMain(o))return l.minor&&!l.patch?"minor":"patch"}let c=d?"pre":"";return r.major!==i.major?c+"major":r.minor!==i.minor?c+"minor":r.patch!==i.patch?c+"patch":"prerelease"}},8645,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t)=>new n(e,t).major},62196,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t)=>new n(e,t).minor},52686,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t)=>new n(e,t).patch},13523,(e,t,r)=>{"use strict";let n=e.r(35759);t.exports=(e,t)=>{let r=n(e,t);return r&&r.prerelease.length?r.prerelease:null}},4668,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t,r)=>new n(e,r).compare(new n(t,r))},60808,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>n(t,e,r)},98480,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t)=>n(e,t,!0)},79552,(e,t,r)=>{"use strict";let n=e.r(20326);t.exports=(e,t,r)=>{let i=new n(e,r),a=new n(t,r);return i.compare(a)||i.compareBuild(a)}},18817,(e,t,r)=>{"use strict";let n=e.r(79552);t.exports=(e,t)=>e.sort((e,r)=>n(e,r,t))},43007,(e,t,r)=>{"use strict";let n=e.r(79552);t.exports=(e,t)=>e.sort((e,r)=>n(r,e,t))},56381,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>n(e,t,r)>0},99583,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>0>n(e,t,r)},66010,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>0===n(e,t,r)},9282,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>0!==n(e,t,r)},87709,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>n(e,t,r)>=0},48467,(e,t,r)=>{"use strict";let n=e.r(4668);t.exports=(e,t,r)=>0>=n(e,t,r)},36269,(e,t,r)=>{"use strict";let n=e.r(66010),i=e.r(9282),a=e.r(56381),s=e.r(87709),o=e.r(99583),l=e.r(48467);t.exports=(e,t,r,d)=>{switch(t){case"===":return"object"==typeof e&&(e=e.version),"object"==typeof r&&(r=r.version),e===r;case"!==":return"object"==typeof e&&(e=e.version),"object"==typeof r&&(r=r.version),e!==r;case"":case"=":case"==":return n(e,r,d);case"!=":return i(e,r,d);case">":return a(e,r,d);case">=":return s(e,r,d);case"<":return o(e,r,d);case"<=":return l(e,r,d);default:throw TypeError(`Invalid operator: ${t}`)}}},64166,(e,t,r)=>{"use strict";let n=e.r(20326),i=e.r(35759),{safeRe:a,t:s}=e.r(70547);t.exports=(e,t)=>{if(e instanceof n)return e;if("number"==typeof e&&(e=String(e)),"string"!=typeof e)return null;let r=null;if((t=t||{}).rtl){let n,i=t.includePrerelease?a[s.COERCERTLFULL]:a[s.COERCERTL];for(;(n=i.exec(e))&&(!r||r.index+r[0].length!==e.length);)r&&n.index+n[0].length===r.index+r[0].length||(r=n),i.lastIndex=n.index+n[1].length+n[2].length;i.lastIndex=-1}else r=e.match(t.includePrerelease?a[s.COERCEFULL]:a[s.COERCE]);if(null===r)return null;let o=r[2],l=r[3]||"0",d=r[4]||"0",c=t.includePrerelease&&r[5]?`-${r[5]}`:"",u=t.includePrerelease&&r[6]?`+${r[6]}`:"";return i(`${o}.${l}.${d}${c}${u}`,t)}},13277,(e,t,r)=>{"use strict";let n=e.r(35759),i=e.r(38703),a=e.r(20326),s=e=>e.startsWith("pre");t.exports=(e,t,r)=>{let o,l;if(!i.RELEASE_TYPES.includes(t))return null;let d=(o=e,l=r,n(o instanceof a?o.version:o,l));return d&&((e,t)=>{if(s(t))return e.version;switch(e.prerelease=[],t){case"major":e.minor=0,e.patch=0;break;case"minor":e.patch=0}return e.format()})(d,t)}},80661,(e,t,r)=>{"use strict";t.exports=class{constructor(){this.max=1e3,this.map=new Map}get(e){let t=this.map.get(e);if(void 0!==t)return this.map.delete(e),this.map.set(e,t),t}delete(e){return this.map.delete(e)}set(e,t){if(!this.delete(e)&&void 0!==t){if(this.map.size>=this.max){let e=this.map.keys().next().value;this.delete(e)}this.map.set(e,t)}return this}}},93006,(e,t,r)=>{"use strict";let n=/\s+/g;t.exports=class e{constructor(t,r){if(r=a(r),t instanceof e)if(!!r.loose===t.loose&&!!r.includePrerelease===t.includePrerelease)return t;else return new e(t.raw,r);if(t instanceof s)return this.raw=t.value,this.set=[[t]],this.formatted=void 0,this;if(this.options=r,this.loose=!!r.loose,this.includePrerelease=!!r.includePrerelease,this.raw=t.trim().replace(n," "),this.set=this.raw.split("||").map(e=>this.parseRange(e.trim())).filter(e=>e.length),!this.set.length)throw TypeError(`Invalid SemVer Range: ${this.raw}`);if(this.set.length>1){const e=this.set[0];if(this.set=this.set.filter(e=>!g(e[0])),0===this.set.length)this.set=[e];else if(this.set.length>1){for(const e of this.set)if(1===e.length&&K(e[0])){this.set=[e];break}}}this.formatted=void 0}get range(){if(void 0===this.formatted){this.formatted="";for(let e=0;e<this.set.length;e++){e>0&&(this.formatted+="||");let t=this.set[e];for(let e=0;e<t.length;e++)e>0&&(this.formatted+=" "),this.formatted+=t[e].toString().trim()}}return this.formatted}format(){return this.range}toString(){return this.range}parseRange(e){e=e.replace(b,"");let t=((this.options.includePrerelease&&y)|(this.options.loose&&f))+":"+e,r=i.get(t);if(r)return r;let n=this.options.loose,a=n?d[u.HYPHENRANGELOOSE]:d[u.HYPHENRANGE];o("hyphen replace",e=e.replace(a,O(this.options.includePrerelease))),o("comparator trim",e=e.replace(d[u.COMPARATORTRIM],h)),o("tilde trim",e=e.replace(d[u.TILDETRIM],p)),o("caret trim",e=e.replace(d[u.CARETTRIM],m));let l=e.split(" ").map(e=>E(e,this.options)).join(" ").split(/\s+/).map(e=>T(e,this.options));n&&(l=l.filter(e=>(o("loose invalid filter",e,this.options),!!e.match(d[u.COMPARATORLOOSE])))),o("range list",l);let c=new Map;for(let e of l.map(e=>new s(e,this.options))){if(g(e))return[e];c.set(e.value,e)}c.size>1&&c.has("")&&c.delete("");let K=[...c.values()];return i.set(t,K),K}intersects(t,r){if(!(t instanceof e))throw TypeError("a Range is required");return this.set.some(e=>v(e,r)&&t.set.some(t=>v(t,r)&&e.every(e=>t.every(t=>e.intersects(t,r)))))}test(e){if(!e)return!1;if("string"==typeof e)try{e=new l(e,this.options)}catch(e){return!1}for(let t=0;t<this.set.length;t++)if(R(this.set[t],e,this.options))return!0;return!1}};let i=new(e.r(80661)),a=e.r(82789),s=e.r(21984),o=e.r(91130),l=e.r(20326),{safeRe:d,src:c,t:u,comparatorTrimReplace:h,tildeTrimReplace:p,caretTrimReplace:m}=e.r(70547),{FLAG_INCLUDE_PRERELEASE:y,FLAG_LOOSE:f}=e.r(38703),b=RegExp(c[u.BUILD],"g"),g=e=>"<0.0.0-0"===e.value,K=e=>""===e.value,v=(e,t)=>{let r=!0,n=e.slice(),i=n.pop();for(;r&&n.length;)r=n.every(e=>i.intersects(e,t)),i=n.pop();return r},E=(e,t)=>(o("comp",e=e.replace(d[u.BUILD],""),t),o("caret",e=k(e,t)),o("tildes",e=w(e,t)),o("xrange",e=x(e,t)),o("stars",e=C(e,t)),e),I=e=>!e||"x"===e.toLowerCase()||"*"===e,w=(e,t)=>e.trim().split(/\s+/).map(e=>S(e,t)).join(" "),S=(e,t)=>{let r=t.loose?d[u.TILDELOOSE]:d[u.TILDE],n=t.includePrerelease?"-0":"";return e.replace(r,(t,r,i,a,s)=>{let l;return o("tilde",e,t,r,i,a,s),I(r)?l="":I(i)?l=`>=${r}.0.0${n} <${+r+1}.0.0-0`:I(a)?l=`>=${r}.${i}.0${n} <${r}.${+i+1}.0-0`:s?(o("replaceTilde pr",s),l=`>=${r}.${i}.${a}-${s} <${r}.${+i+1}.0-0`):l=`>=${r}.${i}.${a} <${r}.${+i+1}.0-0`,o("tilde return",l),l})},k=(e,t)=>e.trim().split(/\s+/).map(e=>j(e,t)).join(" "),j=(e,t)=>{o("caret",e,t);let r=t.loose?d[u.CARETLOOSE]:d[u.CARET],n=t.includePrerelease?"-0":"";return e.replace(r,(t,r,i,a,s)=>{let l;return o("caret",e,t,r,i,a,s),I(r)?l="":I(i)?l=`>=${r}.0.0${n} <${+r+1}.0.0-0`:I(a)?l="0"===r?`>=${r}.${i}.0${n} <${r}.${+i+1}.0-0`:`>=${r}.${i}.0${n} <${+r+1}.0.0-0`:s?(o("replaceCaret pr",s),l="0"===r?"0"===i?`>=${r}.${i}.${a}-${s} <${r}.${i}.${+a+1}-0`:`>=${r}.${i}.${a}-${s} <${r}.${+i+1}.0-0`:`>=${r}.${i}.${a}-${s} <${+r+1}.0.0-0`):(o("no pr"),l="0"===r?"0"===i?`>=${r}.${i}.${a} <${r}.${i}.${+a+1}-0`:`>=${r}.${i}.${a} <${r}.${+i+1}.0-0`:`>=${r}.${i}.${a} <${+r+1}.0.0-0`),o("caret return",l),l})},x=(e,t)=>(o("replaceXRanges",e,t),e.split(/\s+/).map(e=>D(e,t)).join(" ")),D=(e,t)=>{e=e.trim();let r=t.loose?d[u.XRANGELOOSE]:d[u.XRANGE];return e.replace(r,(r,n,i,a,s,l)=>{let d,c,u;if(o("xRange",e,r,n,i,a,s,l),d=i,c=a,u=s,I(d)&&!I(c)||I(c)&&u&&!I(u))return e;let h=I(i),p=h||I(a),m=p||I(s);return"="===n&&m&&(n=""),l=t.includePrerelease?"-0":"",h?r=">"===n||"<"===n?"<0.0.0-0":"*":n&&m?(p&&(a=0),s=0,">"===n?(n=">=",p?(i=+i+1,a=0):a=+a+1,s=0):"<="===n&&(n="<",p?i=+i+1:a=+a+1),"<"===n&&(l="-0"),r=`${n+i}.${a}.${s}${l}`):p?r=`>=${i}.0.0${l} <${+i+1}.0.0-0`:m&&(r=`>=${i}.${a}.0${l} <${i}.${+a+1}.0-0`),o("xRange return",r),r})},C=(e,t)=>(o("replaceStars",e,t),e.trim().replace(d[u.STAR],"")),T=(e,t)=>(o("replaceGTE0",e,t),e.trim().replace(d[t.includePrerelease?u.GTE0PRE:u.GTE0],"")),O=e=>(t,r,n,i,a,s,o,l,d,c,u,h)=>(r=I(n)?"":I(i)?`>=${n}.0.0${e?"-0":""}`:I(a)?`>=${n}.${i}.0${e?"-0":""}`:s?`>=${r}`:`>=${r}${e?"-0":""}`,l=I(d)?"":I(c)?`<${+d+1}.0.0-0`:I(u)?`<${d}.${+c+1}.0-0`:h?`<=${d}.${c}.${u}-${h}`:e?`<${d}.${c}.${+u+1}-0`:`<=${l}`,`${r} ${l}`.trim()),R=(e,t,r)=>{for(let r=0;r<e.length;r++)if(!e[r].test(t))return!1;if(t.prerelease.length&&!r.includePrerelease){for(let r=0;r<e.length;r++)if(o(e[r].semver),e[r].semver!==s.ANY&&e[r].semver.prerelease.length>0){let n=e[r].semver;if(n.major===t.major&&n.minor===t.minor&&n.patch===t.patch)return!0}return!1}return!0}},21984,(e,t,r)=>{"use strict";let n=Symbol("SemVer ANY");t.exports=class e{static get ANY(){return n}constructor(t,r){if(r=i(r),t instanceof e)if(!!r.loose===t.loose)return t;else t=t.value;l("comparator",t=t.trim().split(/\s+/).join(" "),r),this.options=r,this.loose=!!r.loose,this.parse(t),this.semver===n?this.value="":this.value=this.operator+this.semver.version,l("comp",this)}parse(e){let t=this.options.loose?a[s.COMPARATORLOOSE]:a[s.COMPARATOR],r=e.match(t);if(!r)throw TypeError(`Invalid comparator: ${e}`);this.operator=void 0!==r[1]?r[1]:"","="===this.operator&&(this.operator=""),r[2]?this.semver=new d(r[2],this.options.loose):this.semver=n}toString(){return this.value}test(e){if(l("Comparator.test",e,this.options.loose),this.semver===n||e===n)return!0;if("string"==typeof e)try{e=new d(e,this.options)}catch(e){return!1}return o(e,this.operator,this.semver,this.options)}intersects(t,r){if(!(t instanceof e))throw TypeError("a Comparator is required");return""===this.operator?""===this.value||new c(t.value,r).test(this.value):""===t.operator?""===t.value||new c(this.value,r).test(t.semver):!((r=i(r)).includePrerelease&&("<0.0.0-0"===this.value||"<0.0.0-0"===t.value)||!r.includePrerelease&&(this.value.startsWith("<0.0.0")||t.value.startsWith("<0.0.0")))&&!!(this.operator.startsWith(">")&&t.operator.startsWith(">")||this.operator.startsWith("<")&&t.operator.startsWith("<")||this.semver.version===t.semver.version&&this.operator.includes("=")&&t.operator.includes("=")||o(this.semver,"<",t.semver,r)&&this.operator.startsWith(">")&&t.operator.startsWith("<")||o(this.semver,">",t.semver,r)&&this.operator.startsWith("<")&&t.operator.startsWith(">"))}};let i=e.r(82789),{safeRe:a,t:s}=e.r(70547),o=e.r(36269),l=e.r(91130),d=e.r(20326),c=e.r(93006)},70482,(e,t,r)=>{"use strict";let n=e.r(93006);t.exports=(e,t,r)=>{try{t=new n(t,r)}catch(e){return!1}return t.test(e)}},87095,(e,t,r)=>{"use strict";let n=e.r(93006);t.exports=(e,t)=>new n(e,t).set.map(e=>e.map(e=>e.value).join(" ").trim().split(" "))},92685,(e,t,r)=>{"use strict";let n=e.r(20326),i=e.r(93006);t.exports=(e,t,r)=>{let a=null,s=null,o=null;try{o=new i(t,r)}catch(e){return null}return e.forEach(e=>{o.test(e)&&(!a||-1===s.compare(e))&&(s=new n(a=e,r))}),a}},92500,(e,t,r)=>{"use strict";let n=e.r(20326),i=e.r(93006);t.exports=(e,t,r)=>{let a=null,s=null,o=null;try{o=new i(t,r)}catch(e){return null}return e.forEach(e=>{o.test(e)&&(!a||1===s.compare(e))&&(s=new n(a=e,r))}),a}},56388,(e,t,r)=>{"use strict";let n=e.r(20326),i=e.r(93006),a=e.r(56381);t.exports=(e,t)=>{e=new i(e,t);let r=new n("0.0.0");if(e.test(r)||(r=new n("0.0.0-0"),e.test(r)))return r;r=null;for(let t=0;t<e.set.length;++t){let i=e.set[t],s=null;i.forEach(e=>{let t=new n(e.semver.version);switch(e.operator){case">":0===t.prerelease.length?t.patch++:t.prerelease.push(0),t.raw=t.format();case"":case">=":(!s||a(t,s))&&(s=t);break;case"<":case"<=":break;default:throw Error(`Unexpected operation: ${e.operator}`)}}),s&&(!r||a(r,s))&&(r=s)}return r&&e.test(r)?r:null}},4934,(e,t,r)=>{"use strict";let n=e.r(93006);t.exports=(e,t)=>{try{return new n(e,t).range||"*"}catch(e){return null}}},66294,(e,t,r)=>{"use strict";let n=e.r(20326),i=e.r(21984),{ANY:a}=i,s=e.r(93006),o=e.r(70482),l=e.r(56381),d=e.r(99583),c=e.r(48467),u=e.r(87709);t.exports=(e,t,r,h)=>{let p,m,y,f,b;switch(e=new n(e,h),t=new s(t,h),r){case">":p=l,m=c,y=d,f=">",b=">=";break;case"<":p=d,m=u,y=l,f="<",b="<=";break;default:throw TypeError('Must provide a hilo val of "<" or ">"')}if(o(e,t,h))return!1;for(let r=0;r<t.set.length;++r){let n=t.set[r],s=null,o=null;if(n.forEach(e=>{e.semver===a&&(e=new i(">=0.0.0")),s=s||e,o=o||e,p(e.semver,s.semver,h)?s=e:y(e.semver,o.semver,h)&&(o=e)}),s.operator===f||s.operator===b||(!o.operator||o.operator===f)&&m(e,o.semver)||o.operator===b&&y(e,o.semver))return!1}return!0}},78757,(e,t,r)=>{"use strict";let n=e.r(66294);t.exports=(e,t,r)=>n(e,t,">",r)},56605,(e,t,r)=>{"use strict";let n=e.r(66294);t.exports=(e,t,r)=>n(e,t,"<",r)},15029,(e,t,r)=>{"use strict";let n=e.r(93006);t.exports=(e,t,r)=>(e=new n(e,r),t=new n(t,r),e.intersects(t,r))},87138,(e,t,r)=>{"use strict";let n=e.r(70482),i=e.r(4668);t.exports=(e,t,r)=>{let a=[],s=null,o=null,l=e.sort((e,t)=>i(e,t,r));for(let e of l)n(e,t,r)?(o=e,s||(s=e)):(o&&a.push([s,o]),o=null,s=null);s&&a.push([s,null]);let d=[];for(let[e,t]of a)e===t?d.push(e):t||e!==l[0]?t?e===l[0]?d.push(`<=${t}`):d.push(`${e} - ${t}`):d.push(`>=${e}`):d.push("*");let c=d.join(" || "),u="string"==typeof t.raw?t.raw:String(t);return c.length<u.length?c:t}},70414,(e,t,r)=>{"use strict";let n=e.r(93006),i=e.r(21984),{ANY:a}=i,s=e.r(70482),o=e.r(4668),l=[new i(">=0.0.0-0")],d=[new i(">=0.0.0")],c=(e,t,r)=>{let n,i,c,p,m,y,f;if(e===t)return!0;if(1===e.length&&e[0].semver===a)if(1===t.length&&t[0].semver===a)return!0;else e=r.includePrerelease?l:d;if(1===t.length&&t[0].semver===a)if(r.includePrerelease)return!0;else t=d;let b=new Set;for(let t of e)">"===t.operator||">="===t.operator?n=u(n,t,r):"<"===t.operator||"<="===t.operator?i=h(i,t,r):b.add(t.semver);if(b.size>1)return null;if(n&&i&&((c=o(n.semver,i.semver,r))>0||0===c&&(">="!==n.operator||"<="!==i.operator)))return null;for(let e of b){if(n&&!s(e,String(n),r)||i&&!s(e,String(i),r))return null;for(let n of t)if(!s(e,String(n),r))return!1;return!0}let g=!!i&&!r.includePrerelease&&!!i.semver.prerelease.length&&i.semver,K=!!n&&!r.includePrerelease&&!!n.semver.prerelease.length&&n.semver;for(let e of(g&&1===g.prerelease.length&&"<"===i.operator&&0===g.prerelease[0]&&(g=!1),t)){if(f=f||">"===e.operator||">="===e.operator,y=y||"<"===e.operator||"<="===e.operator,n){if(K&&e.semver.prerelease&&e.semver.prerelease.length&&e.semver.major===K.major&&e.semver.minor===K.minor&&e.semver.patch===K.patch&&(K=!1),">"===e.operator||">="===e.operator){if((p=u(n,e,r))===e&&p!==n)return!1}else if(">="===n.operator&&!e.test(n.semver))return!1}if(i){if(g&&e.semver.prerelease&&e.semver.prerelease.length&&e.semver.major===g.major&&e.semver.minor===g.minor&&e.semver.patch===g.patch&&(g=!1),"<"===e.operator||"<="===e.operator){if((m=h(i,e,r))===e&&m!==i)return!1}else if("<="===i.operator&&!e.test(i.semver))return!1}if(!e.operator&&(i||n)&&0!==c)return!1}return(!n||!y||!!i||0===c)&&(!i||!f||!!n||0===c)&&!K&&!g&&!0},u=(e,t,r)=>{if(!e)return t;let n=o(e.semver,t.semver,r);return n>0?e:n<0||">"===t.operator&&">="===e.operator?t:e},h=(e,t,r)=>{if(!e)return t;let n=o(e.semver,t.semver,r);return n<0?e:n>0||"<"===t.operator&&"<="===e.operator?t:e};t.exports=(e,t,r={})=>{if(e===t)return!0;e=new n(e,r),t=new n(t,r);let i=!1;e:for(let n of e.set){for(let e of t.set){let t=c(n,e,r);if(i=i||null!==t,t)continue e}if(i)return!1}return!0}},48680,(e,t,r)=>{"use strict";let n=e.r(70547),i=e.r(38703),a=e.r(20326),s=e.r(18429),o=e.r(35759),l=e.r(32),d=e.r(76730),c=e.r(96161),u=e.r(16022),h=e.r(8645),p=e.r(62196),m=e.r(52686),y=e.r(13523),f=e.r(4668),b=e.r(60808),g=e.r(98480),K=e.r(79552),v=e.r(18817),E=e.r(43007),I=e.r(56381),w=e.r(99583),S=e.r(66010),k=e.r(9282),j=e.r(87709),x=e.r(48467),D=e.r(36269),C=e.r(64166),T=e.r(13277),O=e.r(21984),R=e.r(93006),A=e.r(70482),M=e.r(87095),N=e.r(92685),P=e.r(92500),J=e.r(56388),L=e.r(4934),q=e.r(66294),F=e.r(78757),V=e.r(56605),_=e.r(15029);t.exports={parse:o,valid:l,clean:d,inc:c,diff:u,major:h,minor:p,patch:m,prerelease:y,compare:f,rcompare:b,compareLoose:g,compareBuild:K,sort:v,rsort:E,gt:I,lt:w,eq:S,neq:k,gte:j,lte:x,cmp:D,coerce:C,truncate:T,Comparator:O,Range:R,satisfies:A,toComparators:M,maxSatisfying:N,minSatisfying:P,minVersion:J,validRange:L,outside:q,gtr:F,ltr:V,intersects:_,simplifyRange:e.r(87138),subset:e.r(70414),SemVer:a,re:n.re,src:n.src,tokens:n.t,SEMVER_SPEC_VERSION:i.SEMVER_SPEC_VERSION,RELEASE_TYPES:i.RELEASE_TYPES,compareIdentifiers:s.compareIdentifiers,rcompareIdentifiers:s.rcompareIdentifiers}}];

//# sourceMappingURL=%5Broot-of-the-server%5D__1pz3m7v._.js.map