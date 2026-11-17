"use client";
import {useEffect,useRef,useState} from 'react';
export default function LazySvgImage({image}:{image:{data:string;x:number;y:number;w:number;h:number;fit:string}}){
 const ref=useRef<SVGImageElement>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{if(!('IntersectionObserver' in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 return <image ref={ref} href={visible?image.data:undefined} x={image.x} y={image.y} width={image.w} height={image.h} preserveAspectRatio={image.fit==='cover'?'xMidYMid slice':'xMidYMid meet'}/>;
}
