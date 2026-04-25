import { useState } from 'react'

export default function OneRecordPage() {
  const [searchCriteria, setSearchCriteria] = useState({
    recordId: '',
    status: '',
    dateFrom: '',
    dateTo: ''
  })
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)

  const handleSearch = (e) => {
    e.preventDefault()
    setIsSearching(true)

    // Simulate search delay
    setTimeout(() => {
      const mockResults = [
        { id: 'REC001', status: 'Active', createdDate: '2024-01-15', description: 'Sample Record 1' },
        { id: 'REC002', status: 'Pending', createdDate: '2024-01-14', description: 'Sample Record 2' },
        { id: 'REC003', status: 'Completed', createdDate: '2024-01-13', description: 'Sample Record 3' },
        { id: 'REC004', status: 'Active', createdDate: '2024-01-12', description: 'Sample Record 4' },
        { id: 'REC005', status: 'Pending', createdDate: '2024-01-11', description: 'Sample Record 5' }
      ]
      setSearchResults(mockResults)
      setIsSearching(false)
    }, 1000)
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setSearchCriteria(prev => ({ ...prev, [name]: value }))
  }

  return (
    <>
      <div className="search-section">
        <h2>Search Criteria</h2>
        <form onSubmit={handleSearch} className="search-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="recordId">Record ID</label>
              <input
                type="text"
                id="recordId"
                name="recordId"
                value={searchCriteria.recordId}
                onChange={handleInputChange}
                placeholder="Enter Record ID"
              />
            </div>
            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                name="status"
                value={searchCriteria.status}
                onChange={handleInputChange}
              >
                <option value="">All Status</option>
                <option value="Active">Active</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="dateFrom">Date From</label>
              <input
                type="date"
                id="dateFrom"
                name="dateFrom"
                value={searchCriteria.dateFrom}
                onChange={handleInputChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="dateTo">Date To</label>
              <input
                type="date"
                id="dateTo"
                name="dateTo"
                value={searchCriteria.dateTo}
                onChange={handleInputChange}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="search-btn" disabled={isSearching}>
              {isSearching ? 'Searching...' : 'Search'}
            </button>
            <button type="button" className="clear-btn" onClick={() => {
              setSearchCriteria({ recordId: '', status: '', dateFrom: '', dateTo: '' })
              setSearchResults([])
            }}>
              Clear
            </button>
          </div>
        </form>
      </div>

      <div className="results-section">
        <h2>Search Results ({searchResults.length})</h2>
        {isSearching ? (
          <div className="loading">Searching...</div>
        ) : searchResults.length > 0 ? (
          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Record ID</th>
                  <th>Status</th>
                  <th>Created Date</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((result) => (
                  <tr key={result.id}>
                    <td>{result.id}</td>
                    <td>
                      <span className={`status-badge status-${result.status.toLowerCase()}`}>
                        {result.status}
                      </span>
                    </td>
                    <td>{result.createdDate}</td>
                    <td>{result.description}</td>
                    <td>
                      <button className="action-btn view-btn">View</button>
                      <button className="action-btn edit-btn">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="no-results">No results found. Please adjust your search criteria.</div>
        )}
      </div>
    </>
  )
}
