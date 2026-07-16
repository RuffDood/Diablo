import { Link, Route, Routes } from 'react-router-dom';
import UniqueList from './pages/UniqueList.jsx';
import UniqueDetail from './pages/UniqueDetail.jsx';

export default function App() {
  return (
    <div className="app">
      <header>
        <h1><Link to="/">Wiki <small>· mod TCP</small></Link></h1>
        <nav className="nav-domaines">
          <span className="domaine actif">Objets uniques</span>
          <span className="domaine avenir" title="À venir">Runewords</span>
          <span className="domaine avenir" title="À venir">Sets</span>
          <span className="domaine avenir" title="À venir">Compétences</span>
          <span className="domaine avenir" title="À venir">Cube</span>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<UniqueList />} />
          <Route path="/uniques/:slug" element={<UniqueDetail />} />
        </Routes>
      </main>
    </div>
  );
}
