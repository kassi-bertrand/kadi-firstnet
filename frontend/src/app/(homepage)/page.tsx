"use client";
import Image from "next/image";
import Map from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

export default function Home() {
  const MAP_BOX_TOKEN = process.env.NEXT_PUBLIC_MAP_BOX_TOKEN;
  return (
    <div className="flex flex-col min-h-screen min-w-screen">
      <Map
        mapboxAccessToken={MAP_BOX_TOKEN}
        initialViewState={{
          longitude: -122.4,
          latitude: 37.8,
          zoom: 14
        }}
        style={{width: "100vw", height: "100vh"}}
        mapStyle="mapbox://styles/mapbox/dark-v9"
      />
      
    </div>
  );
}
